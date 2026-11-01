from django.test import SimpleTestCase
from rest_framework.test import APIClient


class HealthEndpointTests(SimpleTestCase):
    def test_browser_accept_header_does_not_cause_missing_template_error(self):
        response = APIClient().get('/api/v1/health', HTTP_HOST='localhost', HTTP_ACCEPT='text/html')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'ok')

    def test_health_endpoint_is_public_and_reports_liveness(self):
        response = APIClient().get("/api/v1/health", HTTP_HOST="localhost")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
