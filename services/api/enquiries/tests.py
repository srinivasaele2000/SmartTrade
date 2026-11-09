from datetime import timedelta

from django.db import DatabaseError, IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from unittest.mock import patch
from rest_framework.test import APIClient

from accounts.models import AccountType
from catalogue.models import Brand, BrandCategory, Category, Product, ProductVariant
from companies.models import CompanyProfile
from companies.tests import grant_staff_permissions, make_account
from dealers.models import AuthorizedDealerGrant, DealerLocation, DealerProductListing
from .models import Enquiry, EnquiryAudit, EnquiryItem, QuotationItem, QuotationRevision


class EnquiryQuotationTests(TestCase):
    def setUp(self):
        self.buyer = make_account('+919811111101', AccountType.PERSONAL)
        self.dealer_account = make_account('+919811111102', AccountType.BUSINESS)
        self.dealer = self.dealer_account.business_profile
        self.dealer.legal_name = 'Quote dealer'
        self.dealer.verification_state = 'VERIFIED'
        self.dealer.save()
        self.company_account = make_account('+919811111103', AccountType.COMPANY)
        self.company = CompanyProfile.objects.create(owner_account=self.company_account, legal_name='Quote supplier', company_email='quote@example.test', verification_state='VERIFIED')
        self.brand = Brand.objects.create(company=self.company, name='Quote brand')
        category = Category.objects.create(name='Quote tools')
        link = BrandCategory.objects.create(brand=self.brand, category=category)
        self.product = Product.objects.create(brand_category=link, name='Drill', code='DR-1', unit='piece', state='PUBLISHED', catalogue_price='100', currency='INR')
        self.variant = ProductVariant.objects.create(product=self.product, name='18V', sku='DR-18')
        self.second_product = Product.objects.create(brand_category=link, name='Bit set', code='BITS', unit='set', state='PUBLISHED')
        self.branch = DealerLocation.objects.create(business=self.dealer, branch_name='Central', address='Market Road', pin_code='560001', locality='Market', district='Bengaluru', state='Karnataka', country='IN', visibility_state='VISIBLE')
        AuthorizedDealerGrant.objects.create(company=self.company, brand=self.brand, business=self.dealer, actor=self.company_account, reason='Confirmed')
        self.listing = DealerProductListing.objects.create(location=self.branch, product=self.product, variant=self.variant, selling_price='110', currency='INR', stock_status='IN_STOCK', quantity='10', state='PUBLISHED')
        self.second_listing = DealerProductListing.objects.create(location=self.branch, product=self.second_product, selling_price='50', currency='INR', stock_status='IN_STOCK', quantity='20', state='PUBLISHED')
        self.buyer_client, self.dealer_client = APIClient(), APIClient()
        self.buyer_client.force_authenticate(self.buyer)
        self.dealer_client.force_authenticate(self.dealer_account)

    def create_enquiry(self):
        response = self.buyer_client.post('/api/v1/enquiries', {
            'branch': self.branch.pk, 'requirements': 'Site delivery discussion', 'notes': 'Buyer note',
            'items': [
                {'listing': self.listing.pk, 'quantity': '2', 'requirement': 'Two kits'},
                {'listing': self.second_listing.pk, 'quantity': '3', 'requirement': ''},
            ],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def quote(self, enquiry, **overrides):
        items = [
            {'enquiry_item': enquiry['items'][0]['id'], 'quantity': '2', 'unit_price': '105.50', 'currency': 'INR', 'notes': 'Dealer price'},
            {'enquiry_item': enquiry['items'][1]['id'], 'quantity': '3', 'unit_price': '45', 'currency': 'INR'},
        ]
        body = {'valid_until': (timezone.now() + timedelta(days=3)).isoformat(), 'dealer_notes': 'Inclusive of no inferred tax', 'items': items} | overrides
        return self.dealer_client.post(f"/api/v1/businesses/me/enquiries/{enquiry['id']}/quotations", body, format='json')

    def test_complete_multi_item_quote_revision_reject_and_accept(self):
        enquiry = self.create_enquiry()
        first = self.quote(enquiry)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data['state'], 'QUOTED')
        self.assertEqual(first.data['quotations'][0]['total'], '346.0000')
        rejected = self.buyer_client.post(f"/api/v1/enquiries/{enquiry['id']}/response", {'action': 'REJECT', 'reason': 'Please revise'}, format='json')
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.data['state'], 'REJECTED')
        revised = self.quote(rejected.data, dealer_notes='Revised offer')
        self.assertEqual(revised.status_code, 201, revised.data)
        self.assertEqual([q['revision'] for q in revised.data['quotations']], [1, 2])
        accepted = self.buyer_client.post(f"/api/v1/enquiries/{enquiry['id']}/response", {'action': 'ACCEPT'}, format='json')
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.data['state'], 'ACCEPTED')
        self.assertEqual(accepted.data['quotations'][-1]['state'], 'ACCEPTED')
        self.assertEqual(list(EnquiryAudit.objects.values_list('action', flat=True)), ['ENQUIRY_SUBMITTED', 'QUOTATION_SENT', 'QUOTATION_REJECTED', 'QUOTATION_REVISED', 'QUOTATION_ACCEPTED'])

    def test_expired_quote_cannot_be_accepted_and_is_reported(self):
        enquiry = self.create_enquiry()
        response = self.quote(enquiry)
        future = timezone.now() + timedelta(days=4)
        with patch('enquiries.serializers.timezone.now', return_value=future):
            detail = self.buyer_client.get(f"/api/v1/enquiries/{enquiry['id']}")
        self.assertEqual(detail.data['quotations'][0]['effective_state'], 'EXPIRED')
        with patch('enquiries.views.timezone.now', return_value=future):
            self.assertEqual(self.buyer_client.post(f"/api/v1/enquiries/{enquiry['id']}/response", {'action': 'ACCEPT'}, format='json').status_code, 409)

    def test_invalid_quantity_currency_incomplete_and_duplicate_items(self):
        base = {'branch': self.branch.pk, 'items': [{'listing': self.listing.pk, 'quantity': '0'}]}
        self.assertEqual(self.buyer_client.post('/api/v1/enquiries', base, format='json').status_code, 400)
        duplicate = {'branch': self.branch.pk, 'items': [{'listing': self.listing.pk, 'quantity': '1'}, {'listing': self.listing.pk, 'quantity': '2'}]}
        self.assertEqual(self.buyer_client.post('/api/v1/enquiries', duplicate, format='json').status_code, 400)
        enquiry = self.create_enquiry()
        response = self.quote(enquiry, items=[{'enquiry_item': enquiry['items'][0]['id'], 'quantity': '1', 'unit_price': '2', 'currency': 'USD'}])
        self.assertEqual(response.status_code, 400)

    def test_cross_branch_and_revoked_authorization_fail_closed(self):
        other = DealerLocation.objects.create(business=self.dealer, branch_name='North', address='Road', pin_code='560002', locality='North', district='Bengaluru', state='Karnataka', country='IN', visibility_state='VISIBLE')
        response = self.buyer_client.post('/api/v1/enquiries', {'branch': other.pk, 'items': [{'listing': self.listing.pk, 'quantity': '1'}]}, format='json')
        self.assertEqual(response.status_code, 400)
        enquiry = self.create_enquiry()
        AuthorizedDealerGrant.objects.filter(brand=self.brand, business=self.dealer).update(active=False)
        self.assertEqual(self.buyer_client.post('/api/v1/enquiries', {'branch': self.branch.pk, 'items': [{'listing': self.listing.pk, 'quantity': '1'}]}, format='json').status_code, 400)
        self.assertEqual(self.quote(enquiry).status_code, 403)

    def test_buyer_and_dealer_object_ownership(self):
        enquiry = self.create_enquiry()
        other_buyer = make_account('+919811111104', AccountType.PERSONAL)
        client = APIClient(); client.force_authenticate(other_buyer)
        self.assertEqual(client.get(f"/api/v1/enquiries/{enquiry['id']}").status_code, 404)
        other_dealer = make_account('+919811111105', AccountType.BUSINESS)
        other_dealer.business_profile.verification_state = 'VERIFIED'; other_dealer.business_profile.save()
        client.force_authenticate(other_dealer)
        self.assertEqual(client.get(f"/api/v1/businesses/me/enquiries/{enquiry['id']}").status_code, 404)
        self.assertEqual(client.post(f"/api/v1/businesses/me/enquiries/{enquiry['id']}/decline", {'reason': 'No'}, format='json').status_code, 404)

    def test_only_personal_buyers_and_verified_dealers(self):
        self.dealer_client.force_authenticate(self.dealer_account)
        self.assertEqual(self.dealer_client.post('/api/v1/enquiries', {'branch': self.branch.pk, 'items': [{'listing': self.listing.pk, 'quantity': '1'}]}, format='json').status_code, 403)
        enquiry = self.create_enquiry()
        self.dealer.verification_state = 'SUSPENDED'; self.dealer.save()
        self.assertEqual(self.quote(enquiry).status_code, 403)

    def test_dealer_decline_and_terminal_transition(self):
        enquiry = self.create_enquiry()
        response = self.dealer_client.post(f"/api/v1/businesses/me/enquiries/{enquiry['id']}/decline", {'reason': 'Unavailable'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['state'], 'DECLINED')
        self.assertEqual(self.quote(enquiry).status_code, 400)

    def test_staff_inspection_requires_read_reports(self):
        enquiry = self.create_enquiry()
        staff = make_account('+919811111106', AccountType.STAFF)
        client = APIClient(); client.force_authenticate(staff)
        self.assertEqual(client.get('/api/v1/staff/enquiries').status_code, 403)
        grant_staff_permissions(staff, ['READ_REPORTS'])
        self.assertEqual(client.get('/api/v1/staff/enquiries').status_code, 200)
        detail = client.get(f"/api/v1/staff/enquiries/{enquiry['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data['audit'][0]['action'], 'ENQUIRY_SUBMITTED')

    def test_database_scope_inr_and_append_only_guards(self):
        enquiry = self.create_enquiry()
        model = Enquiry.objects.get(pk=enquiry['id'])
        other = DealerLocation.objects.create(business=self.dealer, branch_name='Other', address='Road', pin_code='560003', locality='Other', district='Bengaluru', state='Karnataka', country='IN')
        listing = DealerProductListing.objects.create(location=other, product=self.second_product, selling_price='2', currency='INR')
        with self.assertRaises(DatabaseError), transaction.atomic():
            EnquiryItem.objects.create(enquiry=model, listing=listing, quantity=1)
        quoted = self.quote(enquiry)
        quotation = QuotationRevision.objects.get(pk=quoted.data['quotations'][0]['id'])
        item = model.items.first()
        with self.assertRaises(IntegrityError), transaction.atomic():
            QuotationItem.objects.create(quotation=quotation, enquiry_item=item, quantity=1, unit_price=1, currency='USD')
        with self.assertRaises(DatabaseError), transaction.atomic():
            EnquiryAudit.objects.update(reason='tamper')
        with self.assertRaises(DatabaseError), transaction.atomic():
            EnquiryAudit.objects.all().delete()
