from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0010_draft_catalogue_item')]

    operations = [
        migrations.AddField(
            model_name='cataloguedocument', name='last_extraction',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='draftcatalogueitem', name='pack_size',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
