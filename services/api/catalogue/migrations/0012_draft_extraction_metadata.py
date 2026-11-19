from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0011_extraction_diagnostics_and_pack_size')]

    operations = [
        migrations.AddField(
            model_name='draftcatalogueitem', name='sub_category',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='draftcatalogueitem', name='specifications',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
