/**
 * [SnapRun Worker Agent]
 * Worker Node(EC2)에 상주하며 Controller의 실행 명령을 대기하는 에이전트입니다.
 * '서버'가 아니라, 요청이 들어오면 Docker 컨테이너(Executor)를 소환하는 '관리자' 역할을 수행합니다.
 *
 * * 실행 방법:
 * 1. Docker 데몬 실행 확인
 * 2. 의존성 설치: npm install
 * 3. 에이전트 가동: node agent.js
 */

const express = require('express');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const agent = express(); // app -> agent로 변수명 변경
const PORT = 3000;

// Middleware: JSON Payload Parsing
agent.use(express.json());

// Constants: 임시 스크립트 저장소 (Sandbox Volume)
const TEMP_DIR = path.join(__dirname, 'temp_scripts');

// Init: Workspace 준비
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

/**
 * Executor: 코드를 격리된 Docker 컨테이너에서 실행합니다.
 * @param {string} code - 사용자 코드
 * @returns {Promise<string>} - 실행 결과 (Stdout)
 */
function executeInSandbox(code) {
    return new Promise((resolve, reject) => {
        const uniqueId = uuidv4();
        const filename = `${uniqueId}.js`;
        const hostFilePath = path.join(TEMP_DIR, filename);
        
        // 1. Code Injection: 호스트 파일시스템에 코드 작성
        fs.writeFileSync(hostFilePath, code);

        // 2. Sandbox Configuration
        // --rm: 1회용 컨테이너 (Ephemaral)
        const dockerArgs = [
            'run',
            '--rm',
            '--name', uniqueId,
            '--memory=128m',
            '--cpus=0.5',
            '-v', `${hostFilePath}:/app/script.js`,
            'node:18-alpine',        // Base Image
            'node', '/app/script.js' // Entrypoint
        ];

        console.log(`[Agent] ⚡ Spawning Sandbox Container: ${uniqueId}`);

        // 3. Spawn Process
        const child = spawn('docker', dockerArgs);

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => stdoutData += data.toString());
        child.stderr.on('data', (data) => stderrData += data.toString());

        // 4. Watchdog Timer (3s Limit)
        const timeout = setTimeout(() => {
            console.error(`[Agent] 🚫 Timeout! Terminating sandbox: ${uniqueId}`);
            exec(`docker kill ${uniqueId}`); 
            child.kill(); 
            reject(new Error('Execution Timed Out (3000ms limit)'));
            cleanup(hostFilePath);
        }, 3000);

        // 5. Result Handler
        child.on('close', (exitCode) => {
            clearTimeout(timeout);
            cleanup(hostFilePath);

            if (exitCode === 0) {
                resolve(stdoutData);
            } else {
                if (!stderrData && !stdoutData) {
                    resolve("Process terminated silently.");
                } else {
                    reject(new Error(stderrData || stdoutData || 'Runtime Error'));
                }
            }
        });
        
        child.on('error', (err) => {
            clearTimeout(timeout);
            cleanup(hostFilePath);
            reject(err);
        });
    });
}

// Helper: Workspace Cleanup
function cleanup(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error("[Agent] Cleanup failed:", e);
    }
}

// Action: Trigger Execution
agent.post('/execute', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ 
            success: false, 
            error: 'Payload must contain "code" field.' 
        });
    }

    const startTime = Date.now();

    try {
        const output = await executeInSandbox(code);
        const duration = Date.now() - startTime;

        console.log(`[Agent] ✅ Execution finished in ${duration}ms`);

        res.json({ 
            success: true, 
            output: output,
            meta: {
                duration: `${duration}ms`,
                executor: 'docker-alpine-node18'
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            meta: {
                duration: `${Date.now() - startTime}ms`
            }
        });
    }
});

// Start Agent Daemon
agent.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`🚀 SnapRun Worker Agent is Online`);
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`📦 Runtime: Docker (Node:18-alpine)`);
    console.log(`========================================`);
});