"""Local-only demo reset. All identities, consent and taxes are fixture data."""
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.core.management.color import no_style
from django.db import connection, transaction
from django.test import override_settings
from django.utils import timezone
from PIL import Image, ImageDraw
from reportlab.pdfgen.canvas import Canvas
from rest_framework.test import APIClient

from accounts.models import Account, AccountType
from catalogue.models import Brand, BrandCategory, Category, Product, ProductVariant
from companies.models import CompanyProfile
from dealers.models import DealerDeclarations, TradeWorkerContact
from enquiries.models import QuotationRevision
from orders.models import Invoice, Order, OrderItem
from orders.views import audit
from .bootstrap_superadmin import Command as BootstrapAdmin
from .provision_dev_admin import assert_local_database


BUYER_MOBILE = '+919848012345'
DEALER_MOBILE = '+919700000002'
COMPANY_MOBILE = '+919700000004'
STAFF_MOBILE = '+919700000001'
BUYER_GSTIN = '36AAAPK1234A1Z5'
CATEGORIES = (
    'Wires & Industrial Cables', 'Modular Switchgear & Distribution',
    'Commercial & Industrial Lighting', 'Conduits, Piping & Installation Accessories',
)
PRODUCTS = (
    ('Polycab', 0, 'PC-OPT-FR-15-RD-90', 'Optima 1.5 sq mm FR Copper Wire', 1850, 'Box', '8544', '90 m · Red'),
    ('Havells', 0, 'HV-LLP-FRLSH-25-BL-90', 'Life Line Plus 2.5 sq mm S3 FR-LSH Wire', 2920, 'Box', '8544', '90 m · Blue'),
    ('Finolex', 0, 'FX-SC-PVC-40-YL-90', '4.0 sq mm Single Core PVC Insulated Cable', 4450, 'Box', '8544', '90 m · Yellow'),
    ('Schneider Electric', 1, 'SE-EASY9-1P-C16', 'Easy9 16A Single Pole C-Curve MCB', 195, 'Unit', '8536', '1 pole · 16 A · C curve'),
    ('Anchor by Panasonic', 1, 'AN-ROMA-6A-1W-WH', 'Roma 6A 1-Way Modular Switch', 38, 'Unit', '8536', 'White · Pack minimum: 20'),
    ('Havells', 1, 'HV-EUROVEE-4P-63-30', 'Eurovee 63A 4-Pole 30mA RCCB', 2850, 'Unit', '8536', '4 poles · 63 A · 30 mA'),
    ('Philips', 2, 'PH-GP-36-2X2-6500', 'GreenPerform 36W 2x2 LED Recessed Panel', 1650, 'Unit', '9405', '6500 K · Cool day white'),
    ('Crompton', 2, 'CR-RAY-50-IP66', '50W Rayline LED High Bay Light', 2200, 'Unit', '9405', '50 W · IP66'),
    ('Sudhakar', 3, 'SU-PVC-MD-20-3M-IV', '20mm Medium Duty PVC Conduit Pipe', 68, 'Length', '3917', '3 m · Ivory · Bundle of 25'),
    ('Precision', 3, 'PR-JBOX-25-4W', '25mm 4-Way Surface Inspection Junction Box', 32, 'Unit', '3917', '25 mm · 4-way'),
)
CONTACTS = (
    ('Ramesh Varma', 'Licensed Electrical Contractor', '9849111223', 'Ameerpet'),
    ('K. Srinivas Rao', 'Master Electrician / Panel Builder', '9849222334', 'Kukatpally'),
    ('Mohammed Arif', 'Residential Wiring Specialist', '9849333445', 'Ranigunj'),
    ('B. Naresh Kumar', 'Industrial Maintenance Electrician', '9849444556', 'Balanagar'),
    ('P. Venkat Ramana', 'Substation & HT Lines Technician', '9849555667', 'Uppal'),
    ('Satish Goud', 'Commercial Lighting Installer', '9849666778', 'Madhapur'),
    ('D. Appa Rao', 'Agricultural Pump & Starter Electrician', '9849777889', 'Miyapur'),
    ('Syed Shakeel', 'Conduit & Cable Tray Contractor', '9849888990', 'Sanathnagar'),
    ('G. Murali Krishna', 'Switchgear Assembly Technician', '9849999001', 'Gachibowli'),
    ('Ch. Venkatesh', 'Smart Home Automation Electrician', '9849000112', 'Jubilee Hills'),
)


def client(account=None):
    api = APIClient(HTTP_HOST='127.0.0.1')
    if account:
        api.force_authenticate(account)
    return api


def api_call(api, method, path, expected, data=None, fmt='json'):
    request = getattr(api, method)
    response = request('/api/v1' + path, data, format=fmt) if data is not None else request('/api/v1' + path)
    if response.status_code != expected:
        raise CommandError(f'{method.upper()} {path}: expected HTTP {expected}, received HTTP {response.status_code}.')
    return response


def add_media(api, product, brand, packaging):
    image = Image.new('RGB', (900, 500), '#e3efe8')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((44, 44, 856, 456), 30, fill='#17392d')
    draw.text((80, 103), brand.upper(), fill='white', font_size=39)
    draw.text((80, 188), product.name, fill='white', font_size=24)
    draw.text((80, 255), product.code, fill='#b4e0c6', font_size=28)
    draw.text((80, 352), 'SMARTTRADE DEMO | PRODUCT CARD', fill='#b4e0c6', font_size=22)
    png = BytesIO()
    image.save(png, format='PNG')
    pdf = BytesIO()
    doc = Canvas(pdf)
    doc.setTitle('SmartTrade demo catalogue: ' + product.code)
    doc.drawString(42, 795, 'SMARTTRADE DEMO CATALOGUE | NOT A MANUFACTURER DATASHEET')
    for index, value in enumerate((brand, product.name, product.code, packaging,
                                  f'HSN {product.specifications["HSN"]} | INR {product.catalogue_price}')):
        doc.drawString(42, 750 - 24 * index, value)
    doc.save()
    path = f'/staff/catalogue/products/{product.pk}'
    for kind, ext, mime, content in [('image', 'png', 'image/png', png), ('catalogue-pdf', 'pdf', 'application/pdf', pdf)]:
        api_call(api, 'post', f'{path}/{kind}', 201, {
            'file': SimpleUploadedFile(f'{product.code}.{ext}', content.getvalue(), content_type=mime),
        }, 'multipart')


def make_order(buyer, seller, branch, order_number, entries, final_state):
    buyer_api, dealer_api = client(buyer), client(seller)
    enquiry = api_call(buyer_api, 'post', '/enquiries', 201, {
        'branch': branch, 'requirements': 'Electrical supply for an installation project',
        'notes': 'SmartTrade local demonstration',
        'items': [{'listing': listing, 'quantity': str(qty), 'requirement': ''} for listing, qty, _ in entries],
    }).data
    prices = {listing: price for listing, _, price in entries}
    api_call(dealer_api, 'post', f'/businesses/me/enquiries/{enquiry["id"]}/quotations', 201, {
        'valid_until': (timezone.now() + timedelta(days=7)).isoformat(), 'dealer_notes': 'Standard trade packing',
        'items': [{'enquiry_item': row['id'], 'quantity': row['quantity'],
                   'unit_price': str(prices[row['listing_id']]), 'currency': 'INR', 'notes': ''} for row in enquiry['items']],
    })
    api_call(buyer_api, 'post', f'/enquiries/{enquiry["id"]}/response', 200, {'action': 'ACCEPT'})
    quote = QuotationRevision.objects.get(enquiry_id=enquiry['id'], state='ACCEPTED')
    order = Order.objects.create(quotation=quote, buyer=buyer, business=seller.business_profile, branch_id=branch, order_number=order_number)
    for item in quote.items.select_related('enquiry_item__listing__product', 'enquiry_item__listing__variant'):
        listing = item.enquiry_item.listing
        OrderItem.objects.create(order=order, quotation_item=item, product_id_snapshot=listing.product_id,
                                 product_name=listing.product.name, product_code=listing.product.code,
                                 variant_id_snapshot=listing.variant_id, variant_sku=listing.variant.sku if listing.variant else '',
                                 quantity=item.quantity, unit_price=item.unit_price)
    audit(order, buyer, 'ORDER_CREATED', 'Local demo seed')
    for action in ('CONFIRM', 'PROCESSING', 'READY') + (('COMPLETE',) if final_state == 'COMPLETED' else ()):
        api_call(dealer_api, 'post', f'/businesses/me/orders/{order.pk}/action', 200, {'action': action})
    return order


def seed_demo():
    staff = BootstrapAdmin().provision(STAFF_MOBILE)
    staff_api = client(staff)
    buyer = Account.objects.create_user(BUYER_MOBILE, AccountType.PERSONAL)
    buyer.personal_profile.__class__.objects.filter(account=buyer).update(
        full_name='Rajesh Kumar', occupation='Proprietor · Sri Krishna Electricals & Hardware',
        locality='Ameerpet', district='Hyderabad', state='Telangana', pin_code='500016',
    )
    seller = Account.objects.create_user(DEALER_MOBILE, AccountType.BUSINESS)
    business = seller.business_profile
    business.legal_name = 'Venkata Sai Electrical Agencies'
    business.owner_name = 'Suresh Reddy'
    business.business_email = 'sales@venkatasai.example.test'
    business.gstin, business.pan = '36AABCV5678B1ZV', 'AABCV5678B'
    business.registration_number = 'TG-ELEC-2026-1082'
    business.registered_address = 'Rashtrapati Road, Ranigunj'
    business.registered_locality, business.registered_district = 'Ranigunj', 'Secunderabad'
    business.registered_state, business.registered_pin_code = 'Telangana', '500003'
    business.verification_state = 'VERIFIED'
    business.save()
    dealer_api = client(seller)
    branches = []
    for name, address, locality, district, state, pin in [
        ('Ranigunj Trade Counter', 'Rashtrapati Road', 'Ranigunj', 'Secunderabad', 'Telangana', '500003'),
        ('Governorpet Trade Branch', 'Eluru Road', 'Governorpet', 'Vijayawada', 'Andhra Pradesh', '520002'),
        ('Chickpet Trade Counter', 'B.V.K. Iyengar Road', 'Chickpet', 'Bengaluru', 'Karnataka', '560053'),
    ]:
        branches.append(api_call(dealer_api, 'post', '/businesses/me/locations', 201, {
            'branch_name': name, 'address': address, 'locality': locality, 'district': district, 'state': state,
            'pin_code': pin, 'country': 'IN', 'active': True, 'visibility_state': 'VISIBLE', 'contact_name': 'Suresh Reddy',
        }).data['id'])
    now = timezone.now()
    TradeWorkerContact.objects.bulk_create([
        TradeWorkerContact(business=business, name=name, trade=trade, mobile_e164='+91' + mobile,
                           location=f'{locality}, Hyderabad', consent_confirmed_at=now)
        for name, trade, mobile, locality in CONTACTS
    ])
    categories = [Category.objects.create(name=name) for name in CATEGORIES]
    brands, listings = {}, {}
    for brand_name, category, sku, name, price, unit, hsn, packaging in PRODUCTS:
        if brand_name not in brands:
            principal = brand_name == 'Polycab'
            owner = Account.objects.create_user(COMPANY_MOBILE if principal else f'+919000009{len(brands):03d}', AccountType.COMPANY)
            company = CompanyProfile.objects.create(
                owner_account=owner, legal_name='Polycab India Enterprise Hub' if principal else f'{brand_name} Demo Catalogue',
                authorized_person_name='Vikram Malhotra' if principal else '', company_email=f'catalogue-{len(brands)}@example.test',
                gstin='36AAACP9876C1Z1' if principal else '', pan='AAACP9876C' if principal else '',
                address_line='Hitec City, Madhapur' if principal else '', area='Madhapur' if principal else '',
                district='Hyderabad' if principal else '', pin_code='500081' if principal else '',
                state_or_region='Telangana' if principal else '', verification_state='VERIFIED',
            )
            brand = brands[brand_name] = Brand.objects.create(company=company, name=brand_name)
            api_call(client(owner), 'post', '/companies/me/dealer-authorizations', 200, {
                'brand': brand.pk, 'business': business.pk, 'active': True, 'reason': 'Authorized local demonstration listing',
            })
        association, _ = BrandCategory.objects.get_or_create(brand=brands[brand_name], category=categories[category])
        product = Product.objects.create(brand_category=association, name=f'{brand_name} {name}', code=sku,
                                         description=f'{packaging}. Demonstration catalogue entry.', specifications={'HSN': hsn, 'Packaging': packaging},
                                         unit=unit, catalogue_price=price, currency='INR', state='PUBLISHED')
        variant = ProductVariant.objects.create(product=product, sku=sku, name=packaging, attributes={'Packaging': packaging})
        add_media(staff_api, product, brand_name, packaging)
        branch = branches[0 if category < 2 else 1 if category == 2 else 2]
        listing = api_call(dealer_api, 'post', '/businesses/me/listings', 201, {
            'location': branch, 'product': product.pk, 'variant': variant.pk, 'selling_price': str(price),
            'currency': 'INR', 'stock_status': 'IN_STOCK', 'quantity': '80', 'state': 'PUBLISHED',
        }).data
        listings[sku] = listing['id'], price
    DealerDeclarations.objects.create(business=business, categories=['Electrical']).brands.set(brands.values())

    first = make_order(buyer, seller, branches[0], 'ORD-2026-1082', [
        (listings['PC-OPT-FR-15-RD-90'][0], 5, 1850), (listings['SE-EASY9-1P-C16'][0], 10, 195),
    ], 'COMPLETED')
    make_order(buyer, seller, branches[1], 'ORD-2026-1095', [(listings['PH-GP-36-2X2-6500'][0], 10, 1650)], 'READY')
    api_call(dealer_api, 'post', f'/businesses/me/orders/{first.pk}/invoice', 201, {
        'kind': 'TAX_INVOICE', 'supply_basis': 'REGISTERED_TAXABLE', 'buyer_gstin': BUYER_GSTIN,
        'place_of_supply': 'Telangana', 'items': [
            {'order_item': item.pk, 'hsn': '8544' if item.product_code.startswith('PC-') else '8536',
             'discount': '0.00', 'tax_rate': '18.00', 'tax_mode': 'CGST_SGST'} for item in first.items.all()
        ],
    })
    invoice = Invoice.objects.get(order=first)
    if (invoice.taxable_total, invoice.cgst_total, invoice.sgst_total, invoice.grand_total) != tuple(map(Decimal, ('11200', '1008', '1008', '13216'))):
        raise CommandError('Unexpected demo invoice totals.')
    api_call(client(), 'get', '/catalogue/products', 200)
    api_call(staff_api, 'get', '/staff/orders', 200)
    api_call(client(buyer), 'get', f'/orders/{first.pk}/invoice/download', 200)
    return staff.pk, bytes(invoice.pdf)


class Command(BaseCommand):
    help = 'Reset and seed only the confirmed local SmartTrade development database.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true')
        parser.add_argument('--backup', type=Path)

    def handle(self, *args, **options):
        assert_local_database()
        backup = options['backup']
        if not options['reset'] or not backup or not backup.is_file():
            raise CommandError('Pass --reset and the verified pre-reset PostgreSQL archive using --backup.')
        with backup.open('rb') as stream:
            if stream.read(5) != b'PGDMP':
                raise CommandError('The backup must be a PostgreSQL custom archive.')
        media_root = Path(settings.CATALOGUE_MEDIA_ROOT)
        export = media_root / 'vault' / 'invoices' / 'INV-2026-1082.pdf'
        if export.exists():
            raise CommandError('The invoice export already exists. Preserve it before running another reset.')
        created_files = []
        try:
            with TemporaryDirectory(prefix='smarttrade-demo-media-') as staging, transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_advisory_xact_lock(731884120)')
                    cursor.execute("SET LOCAL lock_timeout = '10s'")
                    tables = connection.introspection.django_table_names(only_existing=True)
                    for statement in connection.ops.sql_flush(no_style(), tables, reset_sequences=False, allow_cascade=False):
                        cursor.execute(statement)
                with override_settings(CATALOGUE_MEDIA_ROOT=Path(staging)):
                    staff_id, invoice = seed_demo()
                outputs = [(media_root / source.relative_to(staging), source.read_bytes())
                           for source in Path(staging).rglob('*') if source.is_file()]
                for path, content in [*outputs, (export, invoice)]:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with path.open('xb') as file:
                        created_files.append(path)
                        file.write(content)
        except Exception:
            for path in created_files:
                path.unlink(missing_ok=True)
            raise
        self.stdout.write(self.style.SUCCESS(f'Demo seeded. Designated staff ID: {staff_id}.'))
