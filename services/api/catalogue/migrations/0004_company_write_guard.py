from django.db import migrations


def forward(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
    CREATE FUNCTION smarttrade_catalogue_company_write() RETURNS trigger AS $$
    DECLARE company_id bigint;
    BEGIN
      IF TG_TABLE_NAME='catalogue_brand' THEN
        company_id := NEW.company_id;
      ELSIF TG_TABLE_NAME='catalogue_brandcategory' THEN
        SELECT b.company_id INTO company_id FROM catalogue_brand b WHERE b.id=NEW.brand_id;
      ELSIF TG_TABLE_NAME='catalogue_product' THEN
        IF TG_OP='UPDATE' THEN
          IF (to_jsonb(NEW)-'moderation_state'-'updated_at')=(to_jsonb(OLD)-'moderation_state'-'updated_at') THEN
            RETURN NEW;
          END IF;
        END IF;
        SELECT b.company_id INTO company_id FROM catalogue_brand b JOIN catalogue_brandcategory bc ON bc.brand_id=b.id WHERE bc.id=NEW.brand_category_id;
      ELSE
        SELECT b.company_id INTO company_id FROM catalogue_product p JOIN catalogue_brandcategory bc ON bc.id=p.brand_category_id JOIN catalogue_brand b ON b.id=bc.brand_id WHERE p.id=NEW.product_id;
      END IF;
      PERFORM c.id FROM companies_companyprofile c JOIN accounts_account a ON a.id=c.owner_account_id
        WHERE c.id=company_id AND c.verification_state='VERIFIED' AND c.activity_state='ACTIVE' AND a.access_state='ACTIVE'
        FOR SHARE OF c, a;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Catalogue writes require an eligible company' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    """)
    for table in ['brand', 'brandcategory', 'product', 'productvariant']:
        schema_editor.execute(f'CREATE TRIGGER catalogue_{table}_company_write BEFORE INSERT OR UPDATE ON catalogue_{table} FOR EACH ROW EXECUTE FUNCTION smarttrade_catalogue_company_write()')


def reverse(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    for table in ['brand', 'brandcategory', 'product', 'productvariant']:
        schema_editor.execute(f'DROP TRIGGER catalogue_{table}_company_write ON catalogue_{table}')
    schema_editor.execute('DROP FUNCTION smarttrade_catalogue_company_write()')


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0003_remove_product_catalogue_price_currency_pair_and_more')]
    operations = [migrations.RunPython(forward, reverse)]
