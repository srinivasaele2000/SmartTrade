from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from .business_calendar import business_datetime, financial_year
from .pdf import invoice_pdf


@override_settings(TIME_ZONE="UTC")
class IndiaInvoiceCalendarTests(SimpleTestCase):
    def test_named_india_timezone_and_financial_year_boundaries(self):
        cases = [
            ("2026-03-30T18:30:00+00:00", "31-03-2026 00:00", "2025-26"),
            ("2026-03-31T18:29:59+00:00", "31-03-2026 23:59", "2025-26"),
            ("2026-03-31T18:30:00+00:00", "01-04-2026 00:00", "2026-27"),
            ("2026-03-31T20:00:00+00:00", "01-04-2026 01:30", "2026-27"),
            ("2026-04-01T00:00:00+00:00", "01-04-2026 05:30", "2026-27"),
        ]
        with timezone.override("America/New_York"):
            for raw, display, year in cases:
                with self.subTest(raw=raw):
                    value = datetime.fromisoformat(raw)
                    local = business_datetime(value)
                    self.assertEqual(local.tzinfo.key, "Asia/Kolkata")
                    self.assertEqual(local.strftime("%d-%m-%Y %H:%M"), display)
                    self.assertEqual(financial_year(value), year)
                    self.assertEqual(value.utcoffset(), dt_timezone.utc.utcoffset(value))

    def test_naive_invoice_datetime_is_not_silently_interpreted(self):
        with self.assertRaises(ValueError):
            financial_year(datetime(2026, 4, 1))

    def test_pdf_date_uses_the_same_india_calendar(self):
        invoice = SimpleNamespace(
            get_kind_display=lambda: "Bill of supply", invoice_number="fixture/2026-27/00001",
            issued_at=datetime.fromisoformat("2026-03-31T20:00:00+00:00"),
            supplier_name="Fixture", supplier_gstin="", buyer_gstin="",
            place_of_supply="Karnataka", supply_basis="UNREGISTERED",
            tax_snapshot={"items": []}, taxable_total=0, cgst_total=0,
            sgst_total=0, igst_total=0, grand_total=0,
            order=SimpleNamespace(order_number="fixture-order"),
        )
        with patch("orders.pdf.Canvas") as canvas:
            invoice_pdf(invoice)
        printed = [call.args[2] for call in canvas.return_value.drawString.call_args_list]
        self.assertIn("Issued (IST): 01-04-2026", printed)
        self.assertNotIn("Issued (IST): 31-03-2026", printed)
