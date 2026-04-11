@echo off
set GCLOUD="C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
set PROJECT=project-2f647b6c-d2ba-4001-970
set ZONE=asia-south1-b
set VM=shoonya-trader

echo === Opening firewall port 3001 ===
%GCLOUD% compute firewall-rules create allow-trading-api --project %PROJECT% --allow tcp:3001 --target-tags http-server --description "Allow backend API port 3001"

echo === Installing Docker on VM ===
%GCLOUD% compute ssh %VM% --zone %ZONE% --project %PROJECT% --command "sudo apt-get update -y && sudo apt-get install -y docker.io && sudo systemctl enable docker && sudo systemctl start docker && sudo usermod -aG docker ubuntu && docker --version && echo DOCKER_OK"

echo === Done ===
