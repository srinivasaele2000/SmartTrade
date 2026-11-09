from django.conf import settings
from django.db import models
from django.db.models import Q


class Enquiry(models.Model):
    class State(models.TextChoices):
        SUBMITTED = 'SUBMITTED', 'Submitted'
        QUOTED = 'QUOTED', 'Quoted'
        ACCEPTED = 'ACCEPTED', 'Accepted'
        REJECTED = 'REJECTED', 'Rejected by buyer'
        DECLINED = 'DECLINED', 'Declined by dealer'

    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='enquiries')
    branch = models.ForeignKey('dealers.DealerLocation', on_delete=models.PROTECT, related_name='enquiries')
    requirements = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    state = models.CharField(max_length=12, choices=State.choices, default=State.SUBMITTED, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(state__in=['SUBMITTED', 'QUOTED', 'ACCEPTED', 'REJECTED', 'DECLINED']), name='enquiry_valid_state')]


class EnquiryItem(models.Model):
    enquiry = models.ForeignKey(Enquiry, on_delete=models.PROTECT, related_name='items')
    listing = models.ForeignKey('dealers.DealerProductListing', on_delete=models.PROTECT, related_name='enquiry_items')
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    requirement = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['enquiry', 'listing'], name='enquiry_unique_listing'),
            models.CheckConstraint(condition=Q(quantity__gt=0), name='enquiry_item_positive_quantity'),
        ]


class QuotationRevision(models.Model):
    class State(models.TextChoices):
        SENT = 'SENT', 'Sent'
        ACCEPTED = 'ACCEPTED', 'Accepted'
        REJECTED = 'REJECTED', 'Rejected'
        SUPERSEDED = 'SUPERSEDED', 'Superseded'

    enquiry = models.ForeignKey(Enquiry, on_delete=models.PROTECT, related_name='quotations')
    revision = models.PositiveIntegerField()
    state = models.CharField(max_length=10, choices=State.choices, default=State.SENT)
    valid_until = models.DateTimeField()
    dealer_notes = models.TextField(blank=True)
    sent_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='sent_quotations')
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['enquiry', 'revision'], name='quotation_unique_revision'),
            models.CheckConstraint(condition=Q(revision__gt=0), name='quotation_positive_revision'),
            models.CheckConstraint(condition=Q(state__in=['SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED']), name='quotation_valid_state'),
        ]


class QuotationItem(models.Model):
    quotation = models.ForeignKey(QuotationRevision, on_delete=models.PROTECT, related_name='items')
    enquiry_item = models.ForeignKey(EnquiryItem, on_delete=models.PROTECT, related_name='quotation_items')
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_price = models.DecimalField(max_digits=18, decimal_places=4)
    currency = models.CharField(max_length=3, default='INR')
    notes = models.CharField(max_length=500, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['quotation', 'enquiry_item'], name='quotation_unique_enquiry_item'),
            models.CheckConstraint(condition=Q(quantity__gt=0), name='quotation_item_positive_quantity'),
            models.CheckConstraint(condition=Q(unit_price__gte=0, currency='INR'), name='quotation_item_inr_price'),
        ]


class EnquiryAudit(models.Model):
    enquiry = models.ForeignKey(Enquiry, on_delete=models.PROTECT, related_name='audit_events')
    quotation = models.ForeignKey(QuotationRevision, null=True, blank=True, on_delete=models.PROTECT, related_name='audit_events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=64)
    reason = models.TextField(blank=True)
    snapshot = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(auto_now_add=True)
