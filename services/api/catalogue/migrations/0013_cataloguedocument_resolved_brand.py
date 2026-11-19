import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0012_draft_extraction_metadata')]

    operations = [
        migrations.AddField(
            model_name='cataloguedocument', name='resolved_brand',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                    to='catalogue.brand'),
        ),
    ]
