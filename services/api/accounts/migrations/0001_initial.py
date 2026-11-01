from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q
import accounts.models


POSTGRES_CREATE_GUARDS = (
"""
CREATE FUNCTION smarttrade_account_state_guard() RETURNS trigger AS $$
BEGIN
    IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
        RAISE EXCEPTION 'account_type is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.access_state IS DISTINCT FROM OLD.access_state THEN
        NEW.token_version := GREATEST(NEW.token_version, OLD.token_version + 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
""",
"""
CREATE TRIGGER accounts_account_state_guard
BEFORE UPDATE OF account_type, access_state ON accounts_account
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_state_guard();
""",
"""
CREATE FUNCTION smarttrade_staff_role_guard() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM accounts_account
        WHERE id = NEW.staff_account_id AND account_type = 'STAFF'
    ) THEN
        RAISE EXCEPTION 'staff role assignments require a STAFF account'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.granted_by_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts_account
        WHERE id = NEW.granted_by_id AND account_type = 'STAFF'
    ) THEN
        RAISE EXCEPTION 'staff role grants require a STAFF actor'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
""",
"""
CREATE TRIGGER accounts_staff_role_guard
BEFORE INSERT OR UPDATE ON accounts_staffroleassignment
FOR EACH ROW EXECUTE FUNCTION smarttrade_staff_role_guard();
""",
"""
CREATE FUNCTION smarttrade_staff_state_guard() RETURNS trigger AS $$
BEGIN
    IF NEW.state IS DISTINCT FROM OLD.state THEN
        UPDATE accounts_account
        SET token_version = token_version + 1
        WHERE id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
""",
"""
CREATE TRIGGER accounts_staff_state_guard
AFTER UPDATE OF state ON accounts_staffprofile
FOR EACH ROW EXECUTE FUNCTION smarttrade_staff_state_guard();
""",
"""
CREATE FUNCTION smarttrade_profile_account_immutable() RETURNS trigger AS $$
BEGIN
    IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'account subtype ownership is immutable'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
""",
"""
CREATE TRIGGER accounts_personalprofile_account_immutable
BEFORE UPDATE OF account_id ON accounts_personalprofile
FOR EACH ROW EXECUTE FUNCTION smarttrade_profile_account_immutable();
""",
"""
CREATE TRIGGER accounts_businessprofile_account_immutable
BEFORE UPDATE OF account_id ON accounts_businessprofile
FOR EACH ROW EXECUTE FUNCTION smarttrade_profile_account_immutable();
""",
"""
CREATE TRIGGER accounts_companyuserprofile_account_immutable
BEFORE UPDATE OF account_id ON accounts_companyuserprofile
FOR EACH ROW EXECUTE FUNCTION smarttrade_profile_account_immutable();
""",
"""
CREATE TRIGGER accounts_staffprofile_account_immutable
BEFORE UPDATE OF account_id ON accounts_staffprofile
FOR EACH ROW EXECUTE FUNCTION smarttrade_profile_account_immutable();
""",
"""
CREATE FUNCTION smarttrade_account_profile_consistency() RETURNS trigger AS $$
DECLARE
    target_account_id bigint;
    account_kind varchar(10);
    profile_count integer;
    matching_profile_count integer;
BEGIN
    IF TG_TABLE_NAME = 'accounts_account' THEN
        target_account_id := COALESCE(NEW.id, OLD.id);
    ELSE
        target_account_id := COALESCE(NEW.account_id, OLD.account_id);
    END IF;

    SELECT account_type INTO account_kind
    FROM accounts_account WHERE id = target_account_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT
        (SELECT count(*) FROM accounts_personalprofile WHERE account_id = target_account_id) +
        (SELECT count(*) FROM accounts_businessprofile WHERE account_id = target_account_id) +
        (SELECT count(*) FROM accounts_companyuserprofile WHERE account_id = target_account_id) +
        (SELECT count(*) FROM accounts_staffprofile WHERE account_id = target_account_id),
        CASE account_kind
            WHEN 'PERSONAL' THEN (SELECT count(*) FROM accounts_personalprofile WHERE account_id = target_account_id)
            WHEN 'BUSINESS' THEN (SELECT count(*) FROM accounts_businessprofile WHERE account_id = target_account_id)
            WHEN 'COMPANY' THEN (SELECT count(*) FROM accounts_companyuserprofile WHERE account_id = target_account_id)
            WHEN 'STAFF' THEN (SELECT count(*) FROM accounts_staffprofile WHERE account_id = target_account_id)
            ELSE 0
        END
    INTO profile_count, matching_profile_count;

    IF profile_count <> 1 OR matching_profile_count <> 1 THEN
        RAISE EXCEPTION 'account must have exactly one matching subtype profile'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
""",
"""
CREATE CONSTRAINT TRIGGER accounts_account_profile_consistency
AFTER INSERT ON accounts_account
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_profile_consistency();
""",
"""
CREATE CONSTRAINT TRIGGER accounts_personalprofile_consistency
AFTER INSERT OR UPDATE OR DELETE ON accounts_personalprofile
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_profile_consistency();
""",
"""
CREATE CONSTRAINT TRIGGER accounts_businessprofile_consistency
AFTER INSERT OR UPDATE OR DELETE ON accounts_businessprofile
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_profile_consistency();
""",
"""
CREATE CONSTRAINT TRIGGER accounts_companyuserprofile_consistency
AFTER INSERT OR UPDATE OR DELETE ON accounts_companyuserprofile
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_profile_consistency();
""",
"""
CREATE CONSTRAINT TRIGGER accounts_staffprofile_consistency
AFTER INSERT OR UPDATE OR DELETE ON accounts_staffprofile
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION smarttrade_account_profile_consistency();
""",
)

POSTGRES_DROP_GUARDS = (
    "DROP TRIGGER IF EXISTS accounts_staffprofile_consistency ON accounts_staffprofile",
    "DROP TRIGGER IF EXISTS accounts_companyuserprofile_consistency ON accounts_companyuserprofile",
    "DROP TRIGGER IF EXISTS accounts_businessprofile_consistency ON accounts_businessprofile",
    "DROP TRIGGER IF EXISTS accounts_personalprofile_consistency ON accounts_personalprofile",
    "DROP TRIGGER IF EXISTS accounts_account_profile_consistency ON accounts_account",
    "DROP TRIGGER IF EXISTS accounts_account_state_guard ON accounts_account",
    "DROP TRIGGER IF EXISTS accounts_staff_state_guard ON accounts_staffprofile",
    "DROP TRIGGER IF EXISTS accounts_personalprofile_account_immutable ON accounts_personalprofile",
    "DROP TRIGGER IF EXISTS accounts_businessprofile_account_immutable ON accounts_businessprofile",
    "DROP TRIGGER IF EXISTS accounts_companyuserprofile_account_immutable ON accounts_companyuserprofile",
    "DROP TRIGGER IF EXISTS accounts_staffprofile_account_immutable ON accounts_staffprofile",
    "DROP TRIGGER IF EXISTS accounts_staff_role_guard ON accounts_staffroleassignment",
    "DROP FUNCTION IF EXISTS smarttrade_account_profile_consistency()",
    "DROP FUNCTION IF EXISTS smarttrade_account_state_guard()",
    "DROP FUNCTION IF EXISTS smarttrade_staff_role_guard()",
    "DROP FUNCTION IF EXISTS smarttrade_staff_state_guard()",
    "DROP FUNCTION IF EXISTS smarttrade_profile_account_immutable()",
)


def install_postgresql_guards(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for statement in POSTGRES_CREATE_GUARDS:
            schema_editor.execute(statement)


def remove_postgresql_guards(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for statement in POSTGRES_DROP_GUARDS:
            schema_editor.execute(statement)


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="Account",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("mobile_e164", models.CharField(max_length=16, unique=True)),
                ("account_type", models.CharField(choices=[("PERSONAL", "Personal"), ("BUSINESS", "Business"), ("COMPANY", "Company"), ("STAFF", "Staff")], max_length=10)),
                ("access_state", models.CharField(choices=[("ACTIVE", "Active"), ("BLOCKED", "Blocked")], default="ACTIVE", max_length=8)),
                ("mobile_verified_at", models.DateTimeField(blank=True, null=True)),
                ("token_version", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=Q(("account_type__in", ["PERSONAL", "BUSINESS", "COMPANY", "STAFF"])), name="account_valid_type"),
                    models.CheckConstraint(condition=Q(("access_state__in", ["ACTIVE", "BLOCKED"])), name="account_valid_access_state"),
                ],
            },
            managers=[("objects", accounts.models.AccountManager())],
        ),
        migrations.CreateModel(
            name="BusinessProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("verification_state", models.CharField(choices=[("PENDING", "Pending"), ("VERIFIED", "Verified"), ("REJECTED", "Rejected"), ("SUSPENDED", "Suspended")], default="PENDING", max_length=10)),
                ("account", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="business_profile", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=Q(("verification_state__in", ["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"])), name="business_valid_verification_state"),
                ],
            },
        ),
        migrations.CreateModel(
            name="CompanyUserProfile",
            fields=[
                ("account", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="company_user_profile", serialize=False, to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="PersonalProfile",
            fields=[
                ("account", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="personal_profile", serialize=False, to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="StaffPermission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=64, unique=True)),
                ("description", models.CharField(blank=True, max_length=255)),
            ],
        ),
        migrations.CreateModel(
            name="StaffProfile",
            fields=[
                ("state", models.CharField(choices=[("ACTIVE", "Active"), ("DISABLED", "Disabled")], default="ACTIVE", max_length=8)),
                ("account", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, primary_key=True, related_name="staff_profile", serialize=False, to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(condition=Q(("state__in", ["ACTIVE", "DISABLED"])), name="staff_valid_state"),
                ],
            },
        ),
        migrations.CreateModel(
            name="StaffRole",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=64, unique=True)),
            ],
        ),
        migrations.CreateModel(
            name="StaffRolePermission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("permission", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.staffpermission")),
                ("role", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to="accounts.staffrole")),
            ],
            options={
                "constraints": [models.UniqueConstraint(fields=("role", "permission"), name="unique_staff_role_permission")],
            },
        ),
        migrations.AddField(
            model_name="staffrole",
            name="permissions",
            field=models.ManyToManyField(related_name="roles", through="accounts.StaffRolePermission", to="accounts.staffpermission"),
        ),
        migrations.CreateModel(
            name="StaffRoleAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("grant_source", models.CharField(choices=[("STAFF", "Staff action"), ("BOOTSTRAP", "Controlled bootstrap")], max_length=9)),
                ("granted_at", models.DateTimeField(auto_now_add=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("granted_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="staff_role_grants_made", to=settings.AUTH_USER_MODEL)),
                ("role", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="accounts.staffrole")),
                ("staff_account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="staff_role_assignments", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(condition=Q(("revoked_at__isnull", True)), fields=("staff_account", "role"), name="unique_active_staff_role_assignment"),
                    models.CheckConstraint(condition=(Q(("grant_source", "BOOTSTRAP"), ("granted_by__isnull", True)) | Q(("grant_source", "STAFF"), ("granted_by__isnull", False))), name="staff_role_grant_source_actor"),
                ],
            },
        ),
        migrations.RunPython(install_postgresql_guards, remove_postgresql_guards),
    ]
