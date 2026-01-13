/**
 * Pose Detection và Comparison Module
 * Sử dụng MediaPipe Pose để nhận diện và so sánh tư thế
 */

class PoseDetector {
    constructor() {
        this.pose = null;
        this.camera = null;
        this.isInitialized = false;
        this.currentPose = null;
        this.targetPose = null;
        
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
            if (landmark.visibility > 0.5) {
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
     * Chuẩn hóa landmarks (scale và center)
     */
    normalizeLandmarks(landmarks) {
        if (!landmarks || landmarks.length === 0) return null;

        // Tìm bounding box
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        landmarks.forEach(landmark => {
            if (landmark.visibility > 0.5) {
                minX = Math.min(minX, landmark.x);
                maxX = Math.max(maxX, landmark.x);
                minY = Math.min(minY, landmark.y);
                maxY = Math.max(maxY, landmark.y);
            }
        });

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

        if (typeof Camera === 'undefined') {
            throw new Error('MediaPipe Camera chưa được load. Vui lòng kiểm tra kết nối internet.');
        }

        this.camera = new Camera(this.videoElement, {
            onFrame: async () => {
                await this.pose.send({ image: this.videoElement });
            },
            width: 640,
            height: 480
        });

        await this.camera.start();
    }

    /**
     * Dừng camera
     */
    stopCamera() {
        if (this.camera) {
            this.camera.stop();
            this.camera = null;
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

        // Các keypoints quan trọng để so sánh
        const importantIndices = [
            0,   // nose
            11, 12, // shoulders
            13, 14, // elbows
            15, 16, // wrists
            23, 24, // hips
            25, 26, // knees
            27, 28  // ankles
        ];

        let totalSimilarity = 0;
        let validPoints = 0;

        importantIndices.forEach(index => {
            const current = this.currentPose[index];
            const target = targetPose[index];

            if (current && target && 
                current.visibility > 0.5 && 
                target.visibility > 0.5) {
                
                // Tính khoảng cách Euclidean
                const dx = current.x - target.x;
                const dy = current.y - target.y;
                const dz = (current.z || 0) - (target.z || 0);
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                // Chuyển đổi distance thành similarity (0-1)
                // Distance càng nhỏ thì similarity càng cao
                const similarity = Math.max(0, 1 - distance * 2);
                totalSimilarity += similarity;
                validPoints++;
            }
        });

        if (validPoints === 0) return 0;

        // Tính trung bình và chuyển sang phần trăm
        const avgSimilarity = totalSimilarity / validPoints;
        return Math.round(avgSimilarity * 100);
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

