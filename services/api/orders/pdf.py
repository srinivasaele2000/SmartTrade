from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas
from .business_calendar import business_datetime

def invoice_pdf(invoice):
    output=BytesIO(); c=Canvas(output,pagesize=A4); y=800
    def line(value,size=10,bold=False):
        nonlocal y
        c.setFont('Helvetica-Bold' if bold else 'Helvetica',size); c.drawString(44,y,str(value)); y-=18
    line('SMARTTRADE '+invoice.get_kind_display().upper(),16,True); line('Invoice: '+invoice.invoice_number,12,True); line('Issued (IST): '+business_datetime(invoice.issued_at).strftime('%d-%m-%Y')); line('Supplier: '+invoice.supplier_name); line('Supplier GSTIN: '+(invoice.supplier_gstin or 'Not applicable')); line('Buyer GSTIN: '+(invoice.buyer_gstin or 'Not provided')); line('Place of supply: '+invoice.place_of_supply); line('Supply basis: '+invoice.supply_basis.replace('_',' ')); y-=8
    for row in invoice.tax_snapshot['items']:
        line(f"{row['product_name']} | HSN {row['hsn'] or '-'} | Qty {row['quantity']} | INR {row['unit_price']}",9,True)
        line(f"Taxable INR {row['taxable_value']} | Discount INR {row['discount']} | GST {row['tax_rate']}% {row['tax_mode']}",8)
    y-=8; line('Taxable value INR '+str(invoice.taxable_total),10,True); line('CGST INR '+str(invoice.cgst_total)); line('SGST INR '+str(invoice.sgst_total)); line('IGST INR '+str(invoice.igst_total)); line('Grand total INR '+str(invoice.grand_total),12,True); line('Generated from immutable SmartTrade order '+invoice.order.order_number,8)
    c.showPage(); c.save(); return output.getvalue()
