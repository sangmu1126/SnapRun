/**
 * [SnapRun Worker Agent]
 * 이 코드는 Worker EC2 노드에서 실행되는 에이전트 서버입니다.
 * Controller로부터 코드를 받아 Docker 컨테이너에서 실행하고 결과를 반환합니다.
 * * 실행 방법:
 * 1. Docker 설치 및 실행
 * 2. npm install express body-parser uuid
 * 3. node worker_agent.js
 */

const express = require('express');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// JSON 요청 바디 파싱
app.use(express.json());

// 임시 파일 저장 경로 (EC2 user home 권장)
const TEMP_DIR = path.join(__dirname, 'temp_scripts');

// 초기화: 임시 디렉토리 생성
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

/**
 * Docker 실행 함수
 * @param {string} code - 실행할 사용자 코드
 * @returns {Promise<string>} - 실행 결과 (stdout)
 */
function runCodeInDocker(code) {
    return new Promise((resolve, reject) => {
        const uniqueId = uuidv4();
        const filename = `${uniqueId}.js`;
        const hostFilePath = path.join(TEMP_DIR, filename);
        
        // 1. 코드를 임시 파일로 저장
        fs.writeFileSync(hostFilePath, code);

        // 2. Docker 명령어 구성
        // 주의: 실제 EC2 환경에 맞게 경로 수정 필요
        // -v 옵션: 호스트의 파일을 컨테이너 내부 /app/script.js로 마운트
        const dockerArgs = [
            'run',
            '--rm',                  // 실행 후 컨테이너 자동 삭제
            '--name', uniqueId,      // 컨테이너 이름 (강제 종료용)
            '--memory=128m',         // 메모리 제한
            '--cpus=0.5',            // CPU 제한
            '-v', `${hostFilePath}:/app/script.js`, // 볼륨 마운트
            'node:18-alpine',        // Node.js 경량 이미지
            'node', '/app/script.js' // 컨테이너 내부 실행 명령
        ];

        console.log(`[${uniqueId}] Executing Docker...`);

        // 3. 프로세스 실행
        const child = spawn('docker', dockerArgs);

        let stdoutData = '';
        let stderrData = '';

        // 표준 출력 수집
        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        // 에러 출력 수집
        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        // 4. 타임아웃 처리 (3초) - 무한루프 방지
        const timeout = setTimeout(() => {
            console.error(`[${uniqueId}] Timeout! Killing container...`);
            // 컨테이너 강제 종료 명령
            exec(`docker kill ${uniqueId}`);
            child.kill(); // spawn 프로세스도 종료
            reject(new Error('Time Limit Exceeded (3000ms)'));
            cleanup(hostFilePath);
        }, 3000);

        // 5. 실행 완료 처리
        child.on('close', (code) => {
            clearTimeout(timeout); // 타임아웃 해제
            cleanup(hostFilePath); // 임시 파일 삭제

            if (code === 0) {
                resolve(stdoutData);
            } else {
                // Docker가 에러 코드로 종료된 경우 (또는 타임아웃으로 kill된 경우)
                // 타임아웃 에러가 이미 발생했다면 무시됨
                if (!stderrData && !stdoutData) { 
                    resolve("Process terminated (Output empty)"); 
                } else {
                    reject(new Error(stderrData || stdoutData || 'Unknown Error'));
                }
            }
        });
        
        // 에러 이벤트 핸들링
        child.on('error', (err) => {
            clearTimeout(timeout);
            cleanup(hostFilePath);
            reject(err);
        });
    });
}

// 임시 파일 삭제 헬퍼
function cleanup(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        console.error("Cleanup error:", e);
    }
}

// API 엔드포인트
app.post('/execute', async (req, res) => {
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Code is required' });
    }

    try {
        const output = await runCodeInDocker(code);
        res.json({ success: true, output: output });
    } catch (error) {
        console.error("Execution failed:", error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            hint: "Check Docker status or code syntax." 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Worker Agent listening on port ${PORT}`);
    console.log(`Make sure Docker is running: 'docker ps'`);
});