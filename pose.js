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
        try {
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
                try {
                    this.currentPose = this.normalizeLandmarks(results.poseLandmarks);
                    this.drawBoundingFrame(results.poseLandmarks, this.canvasCtx);
                    this.drawPose(results.poseLandmarks, this.canvasCtx);
                } catch (error) {
                    console.error('Lỗi khi vẽ skeleton:', error);
                    // Vẫn vẽ skeleton cơ bản nếu có lỗi
                    this.drawPose(results.poseLandmarks, this.canvasCtx);
                }
            } else {
                this.currentPose = null;
            }

            this.canvasCtx.restore();
        } catch (error) {
            console.error('Lỗi trong onResults:', error);
        }
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
        try {
            if (!landmarks || landmarks.length === 0) return null;

            // Tìm bounding box
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;

            landmarks.forEach(landmark => {
                if (landmark && typeof landmark.x === 'number' && typeof landmark.y === 'number') {
                    if ((landmark.visibility ?? 1) > 0.5) {
                        minX = Math.min(minX, landmark.x);
                        maxX = Math.max(maxX, landmark.x);
                        minY = Math.min(minY, landmark.y);
                        maxY = Math.max(maxY, landmark.y);
                    }
                }
            });

            // Nếu không có điểm đủ visibility, dùng toàn bộ điểm
            if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
                const validLandmarks = landmarks.filter(l => l && typeof l.x === 'number' && typeof l.y === 'number');
                if (validLandmarks.length === 0) return null;
                
                minX = Math.min(...validLandmarks.map(l => l.x));
                maxX = Math.max(...validLandmarks.map(l => l.x));
                minY = Math.min(...validLandmarks.map(l => l.y));
                maxY = Math.max(...validLandmarks.map(l => l.y));
            }

            const width = maxX - minX;
            const height = maxY - minY;
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            // Chuẩn hóa về tâm (0, 0) và scale
            const scale = Math.max(width, height, 0.01); // Tối thiểu 0.01 để tránh chia 0
            if (scale <= 0) return null;

            const normalized = landmarks.map(landmark => {
                if (!landmark || typeof landmark.x !== 'number' || typeof landmark.y !== 'number') {
                    return { x: 0, y: 0, z: 0, visibility: 0 };
                }
                return {
                    x: (landmark.x - centerX) / scale,
                    y: (landmark.y - centerY) / scale,
                    z: (landmark.z || 0) / scale,
                    visibility: landmark.visibility ?? 0
                };
            });

            return normalized;
        } catch (error) {
            console.error('Lỗi trong normalizeLandmarks:', error);
            return null;
        }
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
     * Cải thiện độ chính xác: so sánh góc, tỷ lệ xương, và vị trí tương đối
     * Trả về similarity score (0-100)
     */
    comparePoses(targetPose) {
        try {
            if (!this.currentPose || !targetPose) {
                return 0;
            }

        // 1. So sánh góc khớp (quan trọng nhất)
        const anglePairs = [
            [11, 13, 15], // left elbow
            [12, 14, 16], // right elbow
            [23, 25, 27], // left knee
            [24, 26, 28], // right knee
            [13, 11, 23], // left shoulder-hip alignment
            [14, 12, 24], // right shoulder-hip alignment
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
                let diff = Math.abs(currentAngle - targetAngle);
                
                // Xử lý góc vòng tròn (ví dụ: 350° và 10° chỉ lệch 20°)
                if (diff > 180) diff = 360 - diff;

                // Cho phép sai lệch hợp lý (90 độ lệch là 0, nhưng tính toán mềm mại hơn)
                // Sử dụng hàm exponential để điểm giảm chậm hơn khi gần đúng
                const similarity = Math.max(0, Math.pow(1 - (diff / 90), 1.5));
                angleSimilarity += similarity;
                angleCount++;
            }
        });

        // 2. So sánh tỷ lệ chiều dài các đoạn xương
        const bonePairs = [
            [11, 13], [13, 15], // left arm
            [12, 14], [14, 16], // right arm
            [23, 25], [25, 27], // left leg
            [24, 26], [26, 28], // right leg
            [11, 12], [23, 24]  // shoulders, hips
        ];

        let boneSimilarity = 0;
        let boneCount = 0;

        bonePairs.forEach(([a, b]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const ta = targetPose[a];
            const tb = targetPose[b];

            if (ca && cb && ta && tb &&
                (ca.visibility ?? 1) > 0.2 &&
                (cb.visibility ?? 1) > 0.2 &&
                (ta.visibility ?? 1) > 0.2 &&
                (tb.visibility ?? 1) > 0.2) {
                
                // Tính tỷ lệ chiều dài
                const currentLen = Math.sqrt(
                    Math.pow(ca.x - cb.x, 2) + Math.pow(ca.y - cb.y, 2)
                );
                const targetLen = Math.sqrt(
                    Math.pow(ta.x - tb.x, 2) + Math.pow(ta.y - tb.y, 2)
                );

                if (targetLen > 0 && currentLen > 0) {
                    const ratio = Math.min(currentLen, targetLen) / Math.max(currentLen, targetLen);
                    // Tăng trọng số cho tỷ lệ gần 1
                    const weightedRatio = Math.pow(ratio, 0.8);
                    boneSimilarity += weightedRatio;
                    boneCount++;
                }
            }
        });

        // 3. So sánh vị trí tương đối của các điểm quan trọng (sau khi normalize)
        const importantIndices = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
        let positionSimilarity = 0;
        let positionCount = 0;

        importantIndices.forEach(index => {
            const current = this.currentPose[index];
            const target = targetPose[index];

            if (current && target &&
                (current.visibility ?? 1) > 0.2 &&
                (target.visibility ?? 1) > 0.2) {
                
                // Tính khoảng cách trên không gian đã chuẩn hóa
                const dx = current.x - target.x;
                const dy = current.y - target.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Cho phép sai lệch hợp lý (distance 0.3 là 0 điểm)
                // Sử dụng hàm mũ để điểm giảm chậm hơn khi gần đúng
                const similarity = Math.max(0, Math.pow(1 - (distance / 0.3), 1.2));
                positionSimilarity += similarity;
                positionCount++;
            }
        });

        // Tính điểm từng phần
        const angleScore = angleCount > 0 ? (angleSimilarity / angleCount) : 0;
        const boneScore = boneCount > 0 ? (boneSimilarity / boneCount) : 0;
        const positionScore = positionCount > 0 ? (positionSimilarity / positionCount) : 0;

        // Kết hợp với trọng số: góc 50%, tỷ lệ xương 30%, vị trí 20%
        // Góc quan trọng nhất vì nó phản ánh đúng tư thế
        let finalScore = angleScore * 0.5 + boneScore * 0.3 + positionScore * 0.2;

        // Nếu có đủ điểm để so sánh, tính điểm chính xác hơn
        if (angleCount >= 4 && boneCount >= 6 && positionCount >= 8) {
            // Điểm đầy đủ, không cần điều chỉnh
        } else if (angleCount >= 2 && boneCount >= 4) {
            // Thiếu một số điểm nhưng vẫn đủ để đánh giá
            // Giảm nhẹ điểm để tránh false positive
            finalScore *= 0.95;
        } else {
            // Thiếu quá nhiều điểm, điểm thấp
            finalScore *= 0.7;
        }

            return Math.round(Math.min(100, finalScore * 100));
        } catch (error) {
            console.error('Lỗi trong comparePoses:', error);
            return 0;
        }
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
        // Danh sách các pose mẫu (normalized landmarks) - Tăng từ 5 lên 15 pose
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
            }),
            // Pose 6: Tư thế tay chéo trước ngực
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.25, x: 0.05, x2: -0.05 },
                wrists: { y: -0.2, x: 0.2, x2: -0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 7: Tư thế tay dang ngang, một chân giơ
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.2 },
                ankles: { y: 0.5, x: -0.1, x2: 0.3 }
            }),
            // Pose 8: Tư thế squat nhẹ, tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.25, x: -0.15, x2: 0.15 },
                elbows: { y: -0.45, x: -0.2, x2: 0.2 },
                wrists: { y: -0.65, x: -0.2, x2: 0.2 },
                hips: { y: 0.15, x: -0.1, x2: 0.1 },
                knees: { y: 0.35, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 9: Tư thế một tay giơ, một tay chống hông
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.25 },
                wrists: { y: -0.7, x: -0.2, x2: 0.3 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 10: Tư thế tay chéo trên đầu
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.45, x: -0.1, x2: 0.1 },
                wrists: { y: -0.6, x: 0.05, x2: -0.05 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 11: Tư thế tay dang rộng, chân rộng
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.2, x2: 0.2 },
                knees: { y: 0.3, x: -0.25, x2: 0.25 },
                ankles: { y: 0.5, x: -0.25, x2: 0.25 }
            }),
            // Pose 12: Tư thế một tay giơ, chân rộng
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.1 },
                wrists: { y: -0.7, x: -0.2, x2: 0.05 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.2, x2: 0.2 },
                ankles: { y: 0.5, x: -0.2, x2: 0.2 }
            }),
            // Pose 13: Tư thế tay chéo dưới
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.15, x: -0.05, x2: 0.05 },
                wrists: { y: 0, x: 0.1, x2: -0.1 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 14: Tư thế tay giơ cao, một chân giơ
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.25 },
                ankles: { y: 0.5, x: -0.1, x2: 0.35 }
            }),
            // Pose 15: Tư thế tay dang ngang, một chân co
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.25 },
                ankles: { y: 0.5, x: -0.1, x2: 0.4 }
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

