@echo off
echo === Creating firewall rules ===
"C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" compute firewall-rules create allow-trading-api --project project-2f647b6c-d2ba-4001-970 --allow tcp:3001 --target-tags http-server --description "Allow backend trading API on port 3001"

echo === Installing Docker on VM ===
"C:\Users\maddy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" compute ssh shoonya-trader --zone asia-south1-b --project project-2f647b6c-d2ba-4001-970 --command "sudo apt-get update -y && sudo apt-get install -y docker.io && sudo systemctl enable docker && sudo systemctl start docker && sudo usermod -aG docker $USER && docker --version"
