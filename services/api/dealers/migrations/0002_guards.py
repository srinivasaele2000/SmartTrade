from django.db import migrations


def forward(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
    CREATE FUNCTION smarttrade_dealer_audit_guard() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'Dealer audit is append-only' USING ERRCODE='23514'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER dealer_audit_guard BEFORE UPDATE OR DELETE ON dealers_dealeraudit FOR EACH ROW EXECUTE FUNCTION smarttrade_dealer_audit_guard();

    CREATE FUNCTION smarttrade_dealer_location_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW.business_id<>OLD.business_id THEN RAISE EXCEPTION 'Branch ownership is immutable' USING ERRCODE='23514'; END IF;
        IF NEW.visibility_state=OLD.visibility_state THEN RETURN NEW; END IF;
      END IF;
      IF NEW.visibility_state='VISIBLE' AND NOT EXISTS (
        SELECT 1 FROM accounts_businessprofile b JOIN accounts_account a ON a.id=b.account_id
        WHERE b.id=NEW.business_id AND b.verification_state='VERIFIED' AND a.access_state='ACTIVE'
      ) THEN RAISE EXCEPTION 'Visible branch requires verified active business' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER dealer_location_guard BEFORE INSERT OR UPDATE ON dealers_dealerlocation FOR EACH ROW EXECUTE FUNCTION smarttrade_dealer_location_guard();

    CREATE FUNCTION smarttrade_dealer_grant_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW.company_id<>OLD.company_id OR NEW.brand_id<>OLD.brand_id OR NEW.business_id<>OLD.business_id THEN
          RAISE EXCEPTION 'Authorization scope is immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM catalogue_brand br JOIN companies_companyprofile c ON c.id=br.company_id JOIN accounts_account a ON a.id=c.owner_account_id
        WHERE br.id=NEW.brand_id AND c.id=NEW.company_id AND c.owner_account_id=NEW.actor_id AND c.verification_state='VERIFIED' AND c.activity_state='ACTIVE' AND a.access_state='ACTIVE'
      ) THEN RAISE EXCEPTION 'Only the eligible owning company can authorize dealers' USING ERRCODE='23514'; END IF;
      IF NEW.active AND NOT EXISTS (
        SELECT 1 FROM accounts_businessprofile b JOIN accounts_account a ON a.id=b.account_id WHERE b.id=NEW.business_id AND b.verification_state='VERIFIED' AND a.access_state='ACTIVE'
      ) THEN RAISE EXCEPTION 'Grant requires verified active dealer' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER dealer_grant_guard BEFORE INSERT OR UPDATE ON dealers_authorizeddealergrant FOR EACH ROW EXECUTE FUNCTION smarttrade_dealer_grant_guard();

    CREATE FUNCTION smarttrade_dealer_listing_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW.location_id<>OLD.location_id OR NEW.product_id<>OLD.product_id OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
          RAISE EXCEPTION 'Listing identity is immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      IF NEW.variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalogue_productvariant v WHERE v.id=NEW.variant_id AND v.product_id=NEW.product_id) THEN
        RAISE EXCEPTION 'Variant must belong to product' USING ERRCODE='23514';
      END IF;
      IF NEW.state='PUBLISHED' AND NOT EXISTS (
        SELECT 1 FROM dealers_dealerlocation l
        JOIN accounts_businessprofile b ON b.id=l.business_id JOIN accounts_account da ON da.id=b.account_id
        JOIN catalogue_product p ON p.id=NEW.product_id JOIN catalogue_brandcategory bc ON bc.id=p.brand_category_id
        JOIN catalogue_category cat ON cat.id=bc.category_id JOIN catalogue_brand br ON br.id=bc.brand_id
        JOIN companies_companyprofile c ON c.id=br.company_id JOIN accounts_account ca ON ca.id=c.owner_account_id
        JOIN dealers_authorizeddealergrant g ON g.company_id=c.id AND g.brand_id=br.id AND g.business_id=b.id
        WHERE l.id=NEW.location_id AND l.active AND NOT l.admin_hidden AND l.visibility_state='VISIBLE'
        AND b.verification_state='VERIFIED' AND da.access_state='ACTIVE'
        AND p.state='PUBLISHED' AND p.moderation_state='VISIBLE' AND cat.active
        AND c.verification_state='VERIFIED' AND c.activity_state='ACTIVE' AND ca.access_state='ACTIVE' AND g.active
        AND (NEW.variant_id IS NULL OR EXISTS (SELECT 1 FROM catalogue_productvariant v WHERE v.id=NEW.variant_id AND v.active))
      ) THEN RAISE EXCEPTION 'Listing is not eligible for publication' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER dealer_listing_guard BEFORE INSERT OR UPDATE ON dealers_dealerproductlisting FOR EACH ROW EXECUTE FUNCTION smarttrade_dealer_listing_guard();
    """)


def reverse(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for subject, table in [('audit', 'dealeraudit'), ('location', 'dealerlocation'), ('grant', 'authorizeddealergrant'), ('listing', 'dealerproductlisting')]:
        schema_editor.execute(f'DROP TRIGGER dealer_{subject}_guard ON dealers_{table}')
        schema_editor.execute(f'DROP FUNCTION smarttrade_dealer_{subject}_guard()')


class Migration(migrations.Migration):
    dependencies = [('dealers', '0001_initial'), ('accounts', '0002_businessprofile_legal_name_and_more')]
    operations = [migrations.RunPython(forward, reverse)]
