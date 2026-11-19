from uuid import uuid4

from django.db import connection, transaction
from rest_framework import serializers

from accounts.models import Account, AccountType, create_account_profile
from companies.models import CompanyProfile
from .models import Brand, CatalogueAudit
from .tagging import normalized_name


def eligible_brands():
    return Brand.objects.filter(company__verification_state='VERIFIED', company__activity_state='ACTIVE',
                                company__owner_account__access_state='ACTIVE').select_related('company').order_by('name', 'pk')


def one_edit_apart(left, right):
    if min(len(left), len(right)) < 6 or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        mismatches = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
        if len(mismatches) == 1:
            return True
        if len(mismatches) == 2:
            first, second = mismatches
            return second == first + 1 and left[first:second + 1] == right[first:second + 1][::-1]
        return False
    shorter, longer = sorted((left, right), key=len)
    difference = next((i for i, (a, b) in enumerate(zip(shorter, longer)) if a != b), len(shorter))
    return shorter[difference:] == longer[difference + 1:]


def brand_matches(name, brands):
    name = name.strip()
    tokens = normalized_name(name).split()
    if not tokens:
        return []
    exact = [brand for brand in brands if brand.name.casefold() == name.casefold()]
    if exact:
        return exact
    labels = [(brand, normalized_name(brand.name).split()) for brand in brands if brand.name.strip()]
    exact_normalized = [brand for brand, parts in labels if ''.join(parts) == ''.join(tokens)]
    if exact_normalized:
        return exact_normalized
    leading = tokens[0]
    full_prefix = [brand for brand, parts in labels if parts and min(len(tokens), len(parts)) > 1 and (
        parts[:len(tokens)] == tokens or tokens[:len(parts)] == parts
    )]
    if full_prefix:
        return full_prefix
    prefix = [brand for brand, parts in labels if parts and (
        (len(leading) >= 3 and parts[0] == leading) or
        (len(leading) >= 5 and parts[0].startswith(leading))
    )]
    if prefix:
        return prefix
    near = [brand for brand, parts in labels if parts and (
        one_edit_apart(tokens[0], parts[0]) or one_edit_apart(''.join(tokens), ''.join(parts))
    )]
    return near


def brand_metadata(brand):
    return {'id': brand.pk, 'name': brand.name, 'company_id': brand.company_id, 'company_name': brand.company.legal_name}


def resolve_document_brand(document, brands, *, use_saved=True):
    if use_saved and document.resolved_brand_id:
        return next((brand for brand in brands if brand.pk == document.resolved_brand_id), None)
    matches = brand_matches(document.brand_name, brands)
    return matches[0] if len(matches) == 1 else None


class BrandProvisioningBlocked(serializers.ValidationError):
    pass


@transaction.atomic
def get_or_provision_verified_brand(brand_name: str, company_name: str | None = None, *, actor=None):
    name = ' '.join(brand_name.split())
    if not normalized_name(name):
        raise BrandProvisioningBlocked({'brand_name': 'Enter a brand name containing letters or numbers.'})
    # Serialize provisioning itself so alternate spellings cannot create parallel owners.
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(%s)', [53197420811])
    matches = brand_matches(name, list(eligible_brands()))
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise BrandProvisioningBlocked({'brand_name': 'Multiple verified brands match. Select the correct brand in the review.'})
    if brand_matches(name, Brand.objects.all()):
        raise BrandProvisioningBlocked({
            'brand_name': 'A matching brand belongs to an ineligible company. Review the company in Companies before publishing.',
        })
    if len(name) > 160:
        raise BrandProvisioningBlocked({'brand_name': 'Use a brand name of at most 160 characters.'})
    company_name = ' '.join(company_name.split()) if company_name else f'{name} Catalogue'
    companies = list(CompanyProfile.objects.filter(legal_name__iexact=company_name).select_related('owner_account')[:2])
    if companies:
        if len(companies) != 1 or not companies[0].can_publish_catalogue:
            raise BrandProvisioningBlocked({'company_name': 'This company name is ambiguous or ineligible. Review it in Companies.'})
        company = companies[0]
    else:
        # This catalogue owner has no dialable number or usable credentials.
        identifier = uuid4().hex
        owner = Account(mobile_e164=f'catalogue-{identifier[:6]}', account_type=AccountType.COMPANY)
        while Account.objects.filter(mobile_e164=owner.mobile_e164).exists():
            owner.mobile_e164 = f'catalogue-{uuid4().hex[:6]}'
        owner.set_unusable_password()
        owner.save()
        create_account_profile(owner)
        company = CompanyProfile.objects.create(owner_account=owner, legal_name=company_name,
                                               company_email=f'{identifier}@catalogue.invalid',
                                               verification_state='VERIFIED')
    brand = Brand.objects.create(company=company, name=name)
    if actor is not None:
        CatalogueAudit.objects.create(actor=actor, action='BRAND_PROVISIONED', brand=brand, company=company,
                                      snapshot=brand_metadata(brand))
    return brand
