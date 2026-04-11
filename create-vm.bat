@echo off
"C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" compute instances create shoonya-trader ^
  --project project-2f647b6c-d2ba-4001-970 ^
  --zone asia-south1-b ^
  --machine-type e2-medium ^
  --image-family ubuntu-2204-lts ^
  --image-project ubuntu-os-cloud ^
  --boot-disk-size 30GB ^
  --boot-disk-type pd-ssd ^
  --tags http-server,https-server
