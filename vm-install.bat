@echo off
"C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" compute ssh shoonya-trader --zone asia-south1-b --project project-2f647b6c-d2ba-4001-970 --command "sudo apt-get update -y && sudo apt-get install -y docker.io && sudo systemctl enable docker && sudo systemctl start docker && sudo usermod -aG docker maddy && docker --version && echo DOCKER_INSTALLED_OK"
