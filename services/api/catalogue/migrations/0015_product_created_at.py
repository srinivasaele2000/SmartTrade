from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):
    dependencies = [('catalogue', '0014_catalogue_pdf_page_count')]

    operations = [
        migrations.AddField(
            model_name='product',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, default=timezone.now),
            preserve_default=False,
        ),
    ]
