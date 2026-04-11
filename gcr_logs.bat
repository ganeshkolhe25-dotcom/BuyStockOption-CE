@echo off
"C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=shoonya-backend" --project project-2f647b6c-d2ba-4001-970 --limit 100 --freshness 2h --format "value(textPayload)"
