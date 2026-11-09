"""India business dates; persisted timestamps remain timezone-aware UTC."""
from zoneinfo import ZoneInfo

from django.utils import timezone

INDIA_TIMEZONE = ZoneInfo("Asia/Kolkata")


def business_datetime(value):
    return timezone.localtime(value, INDIA_TIMEZONE)


def financial_year(value):
    local = business_datetime(value)
    start = local.year if local.month >= 4 else local.year - 1
    return f"{start}-{str(start + 1)[-2:]}"
