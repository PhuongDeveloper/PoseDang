/**
 * Pose Detection và Comparison Module
 * Sử dụng MediaPipe Pose để nhận diện và so sánh tư thế
 */

class PoseDetector {
    constructor() {
        this.pose = null;
        this.isInitialized = false;
        this.currentPose = null;
        this.targetPose = null;
        this.isRunning = false;
        this._rafId = null;
        
        // Canvas elements
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;
    }

    /**
     * Khởi tạo MediaPipe Pose
     */
    async initialize(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.canvasCtx = canvasElement.getContext('2d');

        // Kiểm tra MediaPipe Pose có sẵn
        if (typeof Pose === 'undefined') {
            throw new Error('MediaPipe Pose chưa được load. Vui lòng kiểm tra kết nối internet.');
        }

        // Cấu hình MediaPipe Pose
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });

        this.pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        // Callback khi detect được pose
        this.pose.onResults((results) => {
            this.onResults(results);
        });

        this.isInitialized = true;
    }

    /**
     * Xử lý kết quả từ MediaPipe
     */
    onResults(results) {
        // Vẽ video frame
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        this.canvasCtx.drawImage(
            results.image, 0, 0, 
            this.canvasElement.width, 
            this.canvasElement.height
        );

        // Vẽ skeleton nếu có pose
        if (results.poseLandmarks) {
            this.currentPose = this.normalizeLandmarks(results.poseLandmarks);
            this.drawBoundingFrame(results.poseLandmarks, this.canvasCtx);
            this.drawPose(results.poseLandmarks, this.canvasCtx);
        } else {
            this.currentPose = null;
        }

        this.canvasCtx.restore();
    }

    /**
     * Vẽ skeleton lên canvas
     */
    drawPose(landmarks, ctx) {
        const connections = [
            // Face
            [0, 1], [1, 2], [2, 3], [3, 7],
            // Upper body
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24],
            // Lower body
            [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
        ];

        // Vẽ connections
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            if (startPoint && endPoint) {
                ctx.beginPath();
                ctx.moveTo(
                    startPoint.x * this.canvasElement.width,
                    startPoint.y * this.canvasElement.height
                );
                ctx.lineTo(
                    endPoint.x * this.canvasElement.width,
                    endPoint.y * this.canvasElement.height
                );
                ctx.stroke();
            }
        });

        // Vẽ keypoints
        ctx.fillStyle = '#ff0000';
        landmarks.forEach((landmark) => {
            if ((landmark.visibility ?? 1) > 0.5) {
                ctx.beginPath();
                ctx.arc(
                    landmark.x * this.canvasElement.width,
                    landmark.y * this.canvasElement.height,
                    5, 0, 2 * Math.PI
                );
                ctx.fill();
            }
        });
    }

    /**
     * Vẽ khung bao quanh cơ thể trên camera (bounding frame)
     */
    drawBoundingFrame(landmarks, ctx) {
        if (!landmarks || !landmarks.length) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        landmarks.forEach(lm => {
            if ((lm.visibility ?? 1) > 0.3) {
                minX = Math.min(minX, lm.x);
                maxX = Math.max(maxX, lm.x);
                minY = Math.min(minY, lm.y);
                maxY = Math.max(maxY, lm.y);
            }
        });

        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return;

        const padding = 0.08;
        minX = Math.max(0, minX - padding);
        maxX = Math.min(1, maxX + padding);
        minY = Math.max(0, minY - padding);
        maxY = Math.min(1, maxY + padding);

        const x = minX * this.canvasElement.width;
        const y = minY * this.canvasElement.height;
        const w = (maxX - minX) * this.canvasElement.width;
        const h = (maxY - minY) * this.canvasElement.height;

        const radius = 20;

        ctx.save();
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.9)';
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);

        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Chuẩn hóa landmarks (scale và center)
     */
    normalizeLandmarks(landmarks) {
        if (!landmarks || landmarks.length === 0) return null;

        // Tìm bounding box
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        landmarks.forEach(landmark => {
            if ((landmark.visibility ?? 1) > 0.5) {
                minX = Math.min(minX, landmark.x);
                maxX = Math.max(maxX, landmark.x);
                minY = Math.min(minY, landmark.y);
                maxY = Math.max(maxY, landmark.y);
            }
        });

        // Nếu không có điểm đủ visibility, dùng toàn bộ điểm
        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            minX = Math.min(...landmarks.map(l => l.x));
            maxX = Math.max(...landmarks.map(l => l.x));
            minY = Math.min(...landmarks.map(l => l.y));
            maxY = Math.max(...landmarks.map(l => l.y));
        }

        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Chuẩn hóa về tâm (0, 0) và scale
        const scale = Math.max(width, height);
        if (scale === 0) return null;

        const normalized = landmarks.map(landmark => ({
            x: (landmark.x - centerX) / scale,
            y: (landmark.y - centerY) / scale,
            z: landmark.z / scale,
            visibility: landmark.visibility
        }));

        return normalized;
    }

    /**
     * Bắt đầu camera
     */
    async startCamera() {
        if (!this.isInitialized) {
            throw new Error('PoseDetector chưa được khởi tạo');
        }

        // Nếu chưa có stream, xin quyền camera
        if (!this.videoElement.srcObject) {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });
            this.videoElement.srcObject = stream;
        }

        // Đảm bảo video đã sẵn sàng
        await new Promise((resolve) => {
            if (this.videoElement.readyState >= 2) {
                resolve();
            } else {
                this.videoElement.onloadedmetadata = resolve;
            }
        });

        this.isRunning = true;

        const processFrame = async () => {
            if (!this.isRunning) return;

            if (this.videoElement.readyState >= this.videoElement.HAVE_ENOUGH_DATA) {
                await this.pose.send({ image: this.videoElement });
            }
            this._rafId = requestAnimationFrame(processFrame);
        };

        processFrame();
    }

    /**
     * Dừng camera
     */
    stopCamera() {
        this.isRunning = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        if (this.videoElement && this.videoElement.srcObject) {
            const tracks = this.videoElement.srcObject.getTracks();
            tracks.forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }
    }

    /**
     * So sánh pose hiện tại với pose mục tiêu
     * Trả về similarity score (0-100)
     */
    comparePoses(targetPose) {
        if (!this.currentPose || !targetPose) {
            return 0;
        }

        // Các keypoints quan trọng để so sánh vị trí
        const importantIndices = [
            0,   // nose
            11, 12, // shoulders
            13, 14, // elbows
            15, 16, // wrists
            23, 24, // hips
            25, 26, // knees
            27, 28  // ankles
        ];

        let positionSimilarity = 0;
        let positionCount = 0;

        importantIndices.forEach(index => {
            const current = this.currentPose[index];
            const target = targetPose[index];

            if (current && target &&
                (current.visibility ?? 1) > 0.2 &&
                (target.visibility ?? 1) > 0.2) {
                
                // Tính khoảng cách Euclidean trên không gian đã chuẩn hóa
                const dx = current.x - target.x;
                const dy = current.y - target.y;
                const dz = (current.z || 0) - (target.z || 0);
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                // Distance càng nhỏ càng tốt
                const similarity = Math.max(0, 1 - distance * 1.5);
                positionSimilarity += similarity;
                positionCount++;
            }
        });

        // So sánh góc khớp để tăng độ chính xác
        const anglePairs = [
            [11, 13, 15], // left elbow
            [12, 14, 16], // right elbow
            [23, 25, 27], // left knee
            [24, 26, 28], // right knee
            [11, 23, 25], // left hip-knee alignment
            [12, 24, 26]  // right hip-knee alignment
        ];

        let angleSimilarity = 0;
        let angleCount = 0;

        anglePairs.forEach(([a, b, c]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const cc = this.currentPose[c];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];

            if (ca && cb && cc && ta && tb && tc &&
                (ca.visibility ?? 1) > 0.2 &&
                (cb.visibility ?? 1) > 0.2 &&
                (cc.visibility ?? 1) > 0.2 &&
                (ta.visibility ?? 1) > 0.2 &&
                (tb.visibility ?? 1) > 0.2 &&
                (tc.visibility ?? 1) > 0.2) {
                
                const currentAngle = this.computeAngle(ca, cb, cc);
                const targetAngle = this.computeAngle(ta, tb, tc);
                const diff = Math.abs(currentAngle - targetAngle);

                // Góc sai lệch càng nhỏ càng tốt
                const similarity = Math.max(0, 1 - (diff / 90)); // 90 độ lệch là 0
                angleSimilarity += similarity;
                angleCount++;
            }
        });

        const posScore = positionCount ? (positionSimilarity / positionCount) : 0;
        const angleScore = angleCount ? (angleSimilarity / angleCount) : 0;

        // Kết hợp: ưu tiên vị trí 60%, góc 40%
        const finalScore = posScore * 0.6 + angleScore * 0.4;
        return Math.round(finalScore * 100);
    }

    /**
     * Tính góc giữa 3 điểm (b-a-c) trả về độ (0-180)
     */
    computeAngle(a, b, c) {
        const ab = { x: a.x - b.x, y: a.y - b.y };
        const cb = { x: c.x - b.x, y: c.y - b.y };
        const dot = ab.x * cb.x + ab.y * cb.y;
        const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
        const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
        if (magAB === 0 || magCB === 0) return 180;
        const cos = Math.min(1, Math.max(-1, dot / (magAB * magCB)));
        return Math.acos(cos) * (180 / Math.PI);
    }

    /**
     * Tạo pose mẫu ngẫu nhiên
     * Trả về normalized landmarks
     */
    generateRandomPose() {
        // Danh sách các pose mẫu (normalized landmarks)
        const poseTemplates = [
            // Pose 1: Tư thế đứng thẳng, tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 2: Tư thế chữ T
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 3: Tư thế một tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: -0.1 },
                wrists: { y: -0.7, x: -0.2, x2: -0.15 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 4: Tư thế chân rộng, tay chống hông
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.25, x: -0.25, x2: 0.25 },
                wrists: { y: -0.2, x: -0.3, x2: 0.3 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.2, x2: 0.2 },
                ankles: { y: 0.5, x: -0.2, x2: 0.2 }
            }),
            // Pose 5: Tư thế một chân giơ
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.4, x: -0.2, x2: 0.2 },
                wrists: { y: -0.5, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.15 },
                ankles: { y: 0.5, x: -0.1, x2: 0.2 }
            })
        ];

        // Chọn ngẫu nhiên một pose
        const randomIndex = Math.floor(Math.random() * poseTemplates.length);
        return poseTemplates[randomIndex];
    }

    /**
     * Tạo pose template từ các điểm chính
     */
    createPoseTemplate(config) {
        const landmarks = new Array(33).fill(null).map(() => ({
            x: 0, y: 0, z: 0, visibility: 0
        }));

        // Nose (0)
        landmarks[0] = { x: 0, y: -0.4, z: 0, visibility: 1 };

        // Left shoulder (11)
        landmarks[11] = { 
            x: config.shoulders.x, 
            y: config.shoulders.y, 
            z: 0, 
            visibility: 1 
        };

        // Right shoulder (12)
        landmarks[12] = { 
            x: config.shoulders.x2, 
            y: config.shoulders.y, 
            z: 0, 
            visibility: 1 
        };

        // Left elbow (13)
        landmarks[13] = { 
            x: config.elbows.x, 
            y: config.elbows.y, 
            z: 0, 
            visibility: 1 
        };

        // Right elbow (14)
        landmarks[14] = { 
            x: config.elbows.x2, 
            y: config.elbows.y, 
            z: 0, 
            visibility: 1 
        };

        // Left wrist (15)
        landmarks[15] = { 
            x: config.wrists.x, 
            y: config.wrists.y, 
            z: 0, 
            visibility: 1 
        };

        // Right wrist (16)
        landmarks[16] = { 
            x: config.wrists.x2, 
            y: config.wrists.y, 
            z: 0, 
            visibility: 1 
        };

        // Left hip (23)
        landmarks[23] = { 
            x: config.hips.x, 
            y: config.hips.y, 
            z: 0, 
            visibility: 1 
        };

        // Right hip (24)
        landmarks[24] = { 
            x: config.hips.x2, 
            y: config.hips.y, 
            z: 0, 
            visibility: 1 
        };

        // Left knee (25)
        landmarks[25] = { 
            x: config.knees.x, 
            y: config.knees.y, 
            z: 0, 
            visibility: 1 
        };

        // Right knee (26)
        landmarks[26] = { 
            x: config.knees.x2, 
            y: config.knees.y, 
            z: 0, 
            visibility: 1 
        };

        // Left ankle (27)
        landmarks[27] = { 
            x: config.ankles.x, 
            y: config.ankles.y, 
            z: 0, 
            visibility: 1 
        };

        // Right ankle (28)
        landmarks[28] = { 
            x: config.ankles.x2, 
            y: config.ankles.y, 
            z: 0, 
            visibility: 1 
        };

        return landmarks;
    }

    /**
     * Vẽ pose silhouette lên canvas
     */
    drawPoseSilhouette(pose, canvas, ctx) {
        if (!pose || !canvas || !ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 6;

        // Vẽ connections
        const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24],
            [23, 25], [25, 27], [24, 26], [26, 28]
        ];

        connections.forEach(([start, end]) => {
            const startPoint = pose[start];
            const endPoint = pose[end];
            if (startPoint && endPoint && 
                startPoint.visibility > 0.5 && 
                endPoint.visibility > 0.5) {
                ctx.beginPath();
                ctx.moveTo(
                    startPoint.x * canvas.width + canvas.width / 2,
                    startPoint.y * canvas.height + canvas.height / 2
                );
                ctx.lineTo(
                    endPoint.x * canvas.width + canvas.width / 2,
                    endPoint.y * canvas.height + canvas.height / 2
                );
                ctx.stroke();
            }
        });

        // Vẽ keypoints (lớn hơn để dễ nhìn)
        pose.forEach((landmark, index) => {
            if (landmark && landmark.visibility > 0.5) {
                ctx.beginPath();
                ctx.arc(
                    landmark.x * canvas.width + canvas.width / 2,
                    landmark.y * canvas.height + canvas.height / 2,
                    10, 0, 2 * Math.PI
                );
                ctx.fill();
            }
        });
    }
}

