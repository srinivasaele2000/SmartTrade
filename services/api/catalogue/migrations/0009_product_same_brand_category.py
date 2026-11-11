from django.db import migrations


def install_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
        CREATE OR REPLACE FUNCTION smarttrade_catalogue_product_guard()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.brand_category_id IS DISTINCT FROM OLD.brand_category_id AND NOT EXISTS (
                SELECT 1
                FROM catalogue_brandcategory previous
                JOIN catalogue_brandcategory target ON target.brand_id = previous.brand_id
                WHERE previous.id = OLD.brand_category_id AND target.id = NEW.brand_category_id
            ) THEN
                RAISE EXCEPTION 'Catalogue brand ownership is immutable' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


def restore_guard(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute("""
        CREATE OR REPLACE FUNCTION smarttrade_catalogue_product_guard()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.brand_category_id <> OLD.brand_category_id THEN
                RAISE EXCEPTION 'Catalogue ownership is immutable' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0008_vault_sub_category')]
    operations = [migrations.RunPython(install_guard, restore_guard)]
