import re


INDIAN_MOBILE_PATTERN = re.compile(r"^\+91[6-9][0-9]{9}$")
INDIAN_PIN_PATTERN = re.compile(r"^[1-9][0-9]{5}$")
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")

INDIAN_STATES_AND_UTS = (
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
    "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
    "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh",
    "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha",
    "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
)
_STATE_BY_CASEFOLD = {value.casefold(): value for value in INDIAN_STATES_AND_UTS}


def canonical_indian_state(value):
    return _STATE_BY_CASEFOLD.get(" ".join(str(value).split()).casefold())
