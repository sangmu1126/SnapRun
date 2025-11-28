⚡ SnapRun

Run Your Functions Instantly over HTTP. > AWS Lambda? Cloud Run? We built our own Serverless Engine on EC2.

📖 Introduction

SnapRun은 EC2와 같은 가상 서버(Bare Metal) 위에서 동작하는 자체 구축 Serverless FaaS(Function as a Service) 플랫폼입니다.

기존의 AWS Lambda나 Cloud Run 같은 매니지드 서비스를 전혀 사용하지 않고, Node.js로 직접 오케스트레이션(Load Balancing) 로직을 구현하고 Docker를 활용하여 안전한 샌드박스 실행 환경을 구축했습니다. HTTP 요청 한 번이면, 당신의 코드는 즉시 격리된 컨테이너에서 실행됩니다.

🚀 Key Features

Custom Load Balancing (No ALB): AWS ALB를 사용하지 않고, Controller Node가 Worker들의 상태(Busy/Idle)를 실시간으로 체크하여 Round Robin 방식으로 작업을 분배합니다.

Docker Sandboxing: 사용자의 코드는 1회용 Docker 컨테이너(alpine) 내부에서 실행되며, 실행 직후 즉시 소멸(--rm)됩니다.

Safety & Security:

Resource Limit: --memory=128m --cpus=0.5 제한으로 이웃 프로세스 간섭(Noisy Neighbor) 방지.

Time Limit: 3초 이상 실행되는 코드는 좀비 프로세스 방지를 위해 강제 종료(Kill)됩니다.

Instant Execution: 미리 준비된(Warm) Worker Node들이 요청 즉시 코드를 실행하여 Cold Start를 최소화합니다.

🏗 Architecture

graph TD
    User[Client] -->|POST /run| Controller[🎮 Controller Node]
    
    subgraph "Orchestration Layer"
        Controller -->|1. Health Check| Registry[Worker Registry]
        Controller -->|2. Schedule| LB[Round Robin Scheduler]
    end
    
    subgraph "Execution Layer (Worker Pool)"
        LB -->|HTTP| Worker1[Worker EC2 - A]
        LB -->|HTTP| Worker2[Worker EC2 - B]
        
        Worker1 -->|Docker Run| Container1[📦 Sandbox Container]
        Worker2 -->|Docker Run| Container2[📦 Sandbox Container]
    end


Controller (Brain): HTTP 요청을 수신하고 최적의 Worker를 선택하여 명령을 내립니다.

Worker (Muscle): 전달받은 코드를 파일로 변환, Docker 컨테이너를 실행하고 Stdout을 캡처하여 반환합니다.

🛠 Tech Stack

Infrastructure: AWS EC2 (Amazon Linux 2)

Orchestrator: Node.js (Custom Logic)

Runtime Engine: Docker (Node:18-alpine image)

Communication: HTTP (Axios)

💻 Getting Started

Prerequisites

AWS EC2 Instances (x2 or more)

Docker Installed (sudo amazon-linux-extras install docker)

Node.js Installed

1. Worker Node Setup (Run on EC2-B, C...)

Worker는 실제 코드를 실행하는 일꾼입니다.

# 1. Clone & Install
git clone [https://github.com/your-team/snaprun.git](https://github.com/your-team/snaprun.git)
cd snaprun/worker
npm install

# 2. Pull Docker Image (Important for speed!)
docker pull node:18-alpine

# 3. Start Agent
node worker_agent.js
# Server running on port 3000...


2. Controller Node Setup (Run on EC2-A)

Controller는 요청을 받아 Worker에게 뿌려주는 관제탑입니다.

cd snaprun/controller
npm install

# Configure Worker IPs in config.js
# export WORKER_NODES="[http://10.0.1.2:3000](http://10.0.1.2:3000),[http://10.0.1.3:3000](http://10.0.1.3:3000)"

node controller.js
# Load Balancer running on port 8080...


🔥 Usage (API Test)

SnapRun이 실행 중이라면, 간단한 HTTP 요청으로 코드를 실행할 수 있습니다.

Request:

curl -X POST http://<CONTROLLER-IP>:8080/run \
-H "Content-Type: application/json" \
-d '{
    "code": "console.log(\"Hello SnapRun! ⚡\");"
}'


Response:

{
    "success": true,
    "output": "Hello SnapRun! ⚡\n",
    "meta": {
        "worker": "Worker-1",
        "duration": "120ms"
    }
}


🛡 Security Strategy (Why is it safe?)

Threat

Protection Mechanism

Infinite Loop

setTimeout in Node.js triggers docker kill after 3 seconds.

Memory Leak

Docker flag --memory=128m kills process on OOM.

File System Access

Container is isolated; cannot access Host EC2 files.

👥 Team

Architect / Backend: [Your Name]

Worker Agent / DevOps: [Teammate Name]

Frontend / Design: [Teammate Name]

Built with passion at Softbank Hackathon Finals 2024