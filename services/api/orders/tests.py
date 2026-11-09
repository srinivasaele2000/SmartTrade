from django.db import DatabaseError, transaction
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import AccountType
from companies.tests import grant_staff_permissions, make_account
from datetime import timedelta
from django.utils import timezone
from catalogue.models import Brand,BrandCategory,Category,Product,ProductVariant
from companies.models import CompanyProfile
from dealers.models import AuthorizedDealerGrant,DealerLocation,DealerProductListing
from .models import Invoice,InvoiceAudit,Order,OrderAudit,OrderItem


class OrderInvoiceTests(TestCase):
    def setUp(self):
        self.buyer=make_account('+919811111101',AccountType.PERSONAL);self.dealer_account=make_account('+919811111102',AccountType.BUSINESS);self.dealer=self.dealer_account.business_profile;self.dealer.legal_name='Order dealer';self.dealer.verification_state='VERIFIED';self.dealer.save();company_account=make_account('+919811111103',AccountType.COMPANY);company=CompanyProfile.objects.create(owner_account=company_account,legal_name='Supplier',company_email='supplier@example.test',verification_state='VERIFIED');brand=Brand.objects.create(company=company,name='Order brand');category=Category.objects.create(name='Order tools');link=BrandCategory.objects.create(brand=brand,category=category);self.product=Product.objects.create(brand_category=link,name='Drill',code='DR-1',unit='piece',state='PUBLISHED',catalogue_price='100',currency='INR');self.variant=ProductVariant.objects.create(product=self.product,name='18V',sku='DR-18');second=Product.objects.create(brand_category=link,name='Bits',code='BITS',unit='set',state='PUBLISHED');self.branch=DealerLocation.objects.create(business=self.dealer,branch_name='Central',address='Road',pin_code='560001',locality='Market',district='Bengaluru',state='Karnataka',country='IN',visibility_state='VISIBLE');AuthorizedDealerGrant.objects.create(company=company,brand=brand,business=self.dealer,actor=company_account,reason='Confirmed');self.listing=DealerProductListing.objects.create(location=self.branch,product=self.product,variant=self.variant,selling_price='110',currency='INR',stock_status='IN_STOCK',quantity='10',state='PUBLISHED');self.second_listing=DealerProductListing.objects.create(location=self.branch,product=second,selling_price='50',currency='INR',stock_status='IN_STOCK',quantity='20',state='PUBLISHED');self.buyer_client=APIClient();self.buyer_client.force_authenticate(self.buyer);self.dealer_client=APIClient();self.dealer_client.force_authenticate(self.dealer_account)
    def create_enquiry(self):
        response=self.buyer_client.post('/api/v1/enquiries',{'branch':self.branch.pk,'items':[{'listing':self.listing.pk,'quantity':'2'},{'listing':self.second_listing.pk,'quantity':'3'}]},format='json');self.assertEqual(response.status_code,201,response.data);return response.data
    def quote(self,enquiry):
        return self.dealer_client.post(f"/api/v1/businesses/me/enquiries/{enquiry['id']}/quotations",{'valid_until':(timezone.now()+timedelta(days=3)).isoformat(),'items':[{'enquiry_item':enquiry['items'][0]['id'],'quantity':'2','unit_price':'105.50','currency':'INR'},{'enquiry_item':enquiry['items'][1]['id'],'quantity':'3','unit_price':'45','currency':'INR'}]},format='json')
    def accepted_quote(self):
        enquiry=self.create_enquiry(); quoted=self.quote(enquiry);self.assertEqual(quoted.status_code,201); accepted=self.buyer_client.post(f"/api/v1/enquiries/{enquiry['id']}/response",{'action':'ACCEPT'},format='json');self.assertEqual(accepted.status_code,200);return accepted.data['quotations'][-1]['id']
    def create_order(self):
        response=self.buyer_client.post('/api/v1/orders',{'quotation':self.accepted_quote()},format='json');self.assertEqual(response.status_code,201,response.data);return response.data
    def confirm(self,order): return self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/action",{'action':'CONFIRM'},format='json')
    def bill(self,order):
        return {'kind':'BILL_OF_SUPPLY','supply_basis':'UNREGISTERED','place_of_supply':'Karnataka','buyer_gstin':'','items':[{'order_item':x['id'],'hsn':'','discount':'0','tax_rate':'0','tax_mode':'NONE'} for x in order['items']]}

    def test_accepted_quote_creates_single_immutable_snapshot_order(self):
        quote=self.accepted_quote();first=self.buyer_client.post('/api/v1/orders',{'quotation':quote},format='json');self.assertEqual(first.status_code,201);self.assertTrue(first.data['order_number'].startswith('STO-'));self.assertEqual(len(first.data['items']),2);self.assertTrue(all(x['currency']=='INR' for x in first.data['items']));second=self.buyer_client.post('/api/v1/orders',{'quotation':quote},format='json');self.assertEqual(second.status_code,409)
        with self.assertRaises(DatabaseError),transaction.atomic(): OrderItem.objects.filter(order_id=first.data['id']).update(unit_price=1)

    def test_order_transition_rules_reasons_and_audit(self):
        order=self.create_order();self.assertEqual(self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/action",{'action':'READY'},format='json').status_code,400);confirmed=self.confirm(order);self.assertEqual(confirmed.data['state'],'CONFIRMED');processing=self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/action",{'action':'PROCESSING'},format='json');self.assertEqual(processing.data['state'],'PROCESSING');self.assertEqual(self.buyer_client.post(f"/api/v1/orders/{order['id']}/cancel",{'reason':'late'},format='json').status_code,400);self.assertEqual(list(OrderAudit.objects.filter(order_id=order['id']).values_list('action',flat=True)),['ORDER_CREATED','ORDER_CONFIRMED','ORDER_PROCESSING'])

    def test_rejection_cancellation_and_ownership(self):
        order=self.create_order();self.assertEqual(self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/action",{'action':'REJECT','reason':''},format='json').status_code,400);rejected=self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/action",{'action':'REJECT','reason':'Cannot fulfil'},format='json');self.assertEqual(rejected.data['state'],'REJECTED')
        other=make_account('+919811111199',AccountType.PERSONAL);client=APIClient();client.force_authenticate(other);self.assertEqual(client.get(f"/api/v1/orders/{order['id']}").status_code,404);self.assertEqual(client.get(f"/api/v1/orders/{order['id']}/invoice/download").status_code,403)

    def test_bill_of_supply_pdf_and_immutability(self):
        order=self.create_order();confirmed=self.confirm(order);response=self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice",self.bill(confirmed.data),format='json');self.assertEqual(response.status_code,201,response.data);self.assertEqual(response.data['invoice']['kind'],'BILL_OF_SUPPLY');download=self.buyer_client.get(f"/api/v1/orders/{order['id']}/invoice/download");self.assertEqual(download.status_code,200);self.assertEqual(download['Content-Type'],'application/pdf');self.assertTrue(download.content.startswith(b'%PDF'))
        self.assertEqual(self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice",self.bill(confirmed.data),format='json').status_code,409)
        with self.assertRaises(DatabaseError),transaction.atomic(): Invoice.objects.filter(order_id=order['id']).update(grand_total=1)
        with self.assertRaises(DatabaseError),transaction.atomic(): InvoiceAudit.objects.filter(invoice__order_id=order['id']).delete()

    def test_tax_invoice_requires_explicit_gst_inputs_and_calculates_inr(self):
        order=self.create_order();confirmed=self.confirm(order);base=self.bill(confirmed.data);base['kind']='TAX_INVOICE';self.assertEqual(self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice",base,format='json').status_code,400)
        self.dealer.gstin='29ABCDE1234F1Z5';self.dealer.save();base['supply_basis']='REGISTERED_TAXABLE';base['items']=[{'order_item':x['id'],'hsn':'8467','discount':'1.00','tax_rate':'18.00','tax_mode':'CGST_SGST'} for x in confirmed.data['items']];response=self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice",base,format='json');self.assertEqual(response.status_code,201,response.data);invoice=response.data['invoice'];self.assertEqual(invoice['kind'],'TAX_INVOICE');self.assertGreater(float(invoice['cgst_total']),0);self.assertEqual(invoice['cgst_total'],invoice['sgst_total']);self.assertEqual(invoice['igst_total'],'0.00')

    def test_invoice_sequence_uses_india_year_and_supplier_scope(self):
        from datetime import datetime
        from unittest.mock import patch
        from .models import InvoiceSequence
        inputs = [
            ('2026-03-31T18:29:59+00:00', '2025-26', '00001'),
            ('2026-03-31T18:30:00+00:00', '2026-27', '00001'),
            ('2026-03-31T20:00:00+00:00', '2026-27', '00002'),
        ]
        numbers = []
        for raw, year, suffix in inputs:
            order = self.create_order()
            confirmed = self.confirm(order)
            with patch('orders.views.timezone.now', return_value=datetime.fromisoformat(raw)):
                result = self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice", self.bill(confirmed.data), format='json')
            self.assertEqual(result.status_code, 201, result.data)
            invoice = result.data['invoice']
            self.assertEqual(invoice['financial_year'], year)
            self.assertEqual(invoice['invoice_number'], f'{self.dealer.pk}/{year}/{suffix}')
            numbers.append(invoice['invoice_number'])
            stored = Invoice.objects.get(pk=invoice['id'])
            self.assertEqual(stored.issued_at.utcoffset(), timedelta(0))
        self.assertEqual(len(set(numbers)), 3)
        other = make_account('+919811111155', AccountType.BUSINESS).business_profile
        # A second supplier's FY sequence starts independently, without modifying
        # issued invoices or any live development data.
        sequence = InvoiceSequence.objects.create(business=other, financial_year='2026-27', next_value=1)
        self.assertEqual(sequence.next_value, 1)
        self.assertEqual(InvoiceSequence.objects.get(business=self.dealer, financial_year='2026-27').next_value, 3)
        with self.assertRaises(DatabaseError), transaction.atomic():
            InvoiceSequence.objects.create(business=self.dealer, financial_year='2026-27', next_value=1)

    def test_download_contract_and_existing_owner_permissions(self):
        order = self.create_order()
        confirmed = self.confirm(order)
        result = self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice", self.bill(confirmed.data), format='json')
        self.assertEqual(result.status_code, 201)
        path = result.data['invoice']['download_url']
        self.assertEqual(path, f"/api/v1/orders/{order['id']}/invoice/download")
        for client in [self.buyer_client, self.dealer_client]:
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertTrue(response.content.startswith(b'%PDF'))
        self.assertEqual(APIClient().get(path).status_code, 401)
        foreign = APIClient()
        foreign.force_authenticate(make_account('+919811111156', AccountType.PERSONAL))
        self.assertEqual(foreign.get(path).status_code, 403)

    def test_buyer_and_dealer_order_enquiry_history_pages(self):
        for _ in range(21):
            self.create_order()
        paths = [('/api/v1/orders', self.buyer_client),
                 ('/api/v1/businesses/me/orders', self.dealer_client),
                 ('/api/v1/enquiries', self.buyer_client),
                 ('/api/v1/businesses/me/enquiries', self.dealer_client)]
        for path, client in paths:
            with self.subTest(path=path):
                first = client.get(path)
                second = client.get(path, {'page': 2})
                self.assertEqual(first.status_code, 200)
                self.assertEqual(second.status_code, 200)
                self.assertEqual(first.data['count'], 21)
                self.assertEqual(len(first.data['results']), 20)
                self.assertEqual(len(second.data['results']), 1)
                self.assertIsNotNone(first.data['next'])
                self.assertIsNotNone(second.data['previous'])
                self.assertIsNone(second.data['next'])
                self.assertTrue(set(x['id'] for x in first.data['results']).isdisjoint(x['id'] for x in second.data['results']))
                again = client.get(path)
                self.assertEqual([x['id'] for x in first.data['results']], [x['id'] for x in again.data['results']])
        filtered = self.dealer_client.get('/api/v1/businesses/me/enquiries', {'state': 'ACCEPTED', 'page': 2})
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data['count'], 21)

    def test_staff_read_only_and_unauthenticated_access(self):
        order=self.create_order();staff=make_account('+919811111198',AccountType.STAFF);client=APIClient();client.force_authenticate(staff);self.assertEqual(client.get('/api/v1/staff/orders').status_code,403);grant_staff_permissions(staff,('READ_REPORTS',));self.assertEqual(client.get('/api/v1/staff/orders').status_code,200);self.assertEqual(client.get(f"/api/v1/staff/orders/{order['id']}").status_code,200);self.assertEqual(APIClient().get('/api/v1/orders').status_code,401)

    def test_staff_search_filters_and_history(self):
        order=self.create_order();confirmed=self.confirm(order);self.dealer_client.post(f"/api/v1/businesses/me/orders/{order['id']}/invoice",self.bill(confirmed.data),format='json');staff=make_account('+919811111197',AccountType.STAFF);grant_staff_permissions(staff,('READ_REPORTS',));client=APIClient();client.force_authenticate(staff)
        found=client.get('/api/v1/staff/orders',{'q':order['order_number'][-8:],'state':'CONFIRMED','invoice_kind':'BILL_OF_SUPPLY'});self.assertEqual(found.status_code,200);self.assertEqual(found.data['count'],1)
        detail=client.get(f"/api/v1/staff/orders/{order['id']}");self.assertEqual(detail.status_code,200);self.assertTrue(detail.data['audit']);self.assertTrue(detail.data['invoice_audit'])
        self.assertEqual(client.get('/api/v1/staff/orders',{'state':'NOT_REAL'}).status_code,400)
