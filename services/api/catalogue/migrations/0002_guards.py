from django.db import migrations


def forward(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
    CREATE FUNCTION smarttrade_catalogue_immutable() RETURNS trigger AS $$
    BEGIN
      IF TG_TABLE_NAME = 'catalogue_catalogueaudit' THEN
        RAISE EXCEPTION 'Catalogue audit is append-only' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    """)
    # Per-table functions avoid accessing nonexistent record fields in PL/pgSQL.
    for table, fields in [('brand', ['company_id']), ('brandcategory', ['brand_id', 'category_id']), ('product', ['brand_category_id']), ('productvariant', ['product_id'])]:
        condition = ' OR '.join(f'NEW.{field}<>OLD.{field}' for field in fields)
        schema_editor.execute(f"CREATE FUNCTION smarttrade_catalogue_{table}_guard() RETURNS trigger AS $$ BEGIN IF {condition} THEN RAISE EXCEPTION 'Catalogue ownership is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;")
        schema_editor.execute(f'CREATE TRIGGER catalogue_{table}_immutable BEFORE UPDATE ON catalogue_{table} FOR EACH ROW EXECUTE FUNCTION smarttrade_catalogue_{table}_guard()')
    schema_editor.execute('CREATE TRIGGER catalogue_audit_immutable BEFORE UPDATE OR DELETE ON catalogue_catalogueaudit FOR EACH ROW EXECUTE FUNCTION smarttrade_catalogue_immutable()')


def reverse(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute('DROP TRIGGER catalogue_audit_immutable ON catalogue_catalogueaudit')
    schema_editor.execute('DROP FUNCTION smarttrade_catalogue_immutable()')
    for table in ['brand', 'brandcategory', 'product', 'productvariant']:
        schema_editor.execute(f'DROP TRIGGER catalogue_{table}_immutable ON catalogue_{table}')
        schema_editor.execute(f'DROP FUNCTION smarttrade_catalogue_{table}_guard()')


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0001_initial')]
    operations = [migrations.RunPython(forward, reverse)]
