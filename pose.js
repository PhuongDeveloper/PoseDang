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
        this.previousLandmarks = null; // Để smoothing
        
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

        // Cấu hình MediaPipe để chính xác hơn
        this.pose.setOptions({
            modelComplexity: 2, // Tăng lên 2 để chính xác hơn (0=fast, 1=balanced, 2=accurate)
            smoothLandmarks: true, // Làm mượt landmarks để giảm nhiễu
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.7, // Tăng từ 0.5 lên 0.7 để chỉ nhận diện khi chắc chắn
            minTrackingConfidence: 0.7 // Tăng từ 0.5 lên 0.7 để tracking ổn định hơn
        });

        // Callback khi detect được pose
        this.pose.onResults((results) => {
            this.onResults(results);
        });

        this.isInitialized = true;
    }

    /**
     * Xử lý kết quả từ MediaPipe với smoothing để chính xác hơn
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
                    // Lọc landmarks có visibility thấp và làm mượt
                    const filteredLandmarks = this.filterAndSmoothLandmarks(results.poseLandmarks);
                    this.currentPose = this.normalizeLandmarks(filteredLandmarks);
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
     * Lọc và làm mượt landmarks để giảm nhiễu từ MediaPipe
     */
    filterAndSmoothLandmarks(landmarks) {
        if (!landmarks || landmarks.length === 0) return landmarks;
        
        // Lưu trữ landmarks trước đó để smoothing
        if (!this.previousLandmarks) {
            this.previousLandmarks = landmarks.map(l => ({ ...l }));
            return landmarks;
        }
        
        // Exponential moving average để làm mượt
        const smoothingFactor = 0.7; // 0.7 = giữ 70% giá trị mới, 30% giá trị cũ
        const smoothed = landmarks.map((landmark, index) => {
            if (!landmark) return landmark;
            
            const prev = this.previousLandmarks[index];
            if (!prev) {
                this.previousLandmarks[index] = { ...landmark };
                return landmark;
            }
            
            // Chỉ smooth nếu visibility đủ cao
            if ((landmark.visibility ?? 1) > 0.3) {
                return {
                    x: landmark.x * smoothingFactor + prev.x * (1 - smoothingFactor),
                    y: landmark.y * smoothingFactor + prev.y * (1 - smoothingFactor),
                    z: landmark.z * smoothingFactor + prev.z * (1 - smoothingFactor),
                    visibility: landmark.visibility
                };
            } else {
                // Nếu visibility thấp, giữ giá trị cũ
                return prev;
            }
        });
        
        this.previousLandmarks = smoothed.map(l => ({ ...l }));
        return smoothed;
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

        // Tính điểm từng phần - đảm bảo không NaN
        const angleScore = (angleCount > 0 && isFinite(angleSimilarity)) ? (angleSimilarity / angleCount) : 0;
        const boneScore = (boneCount > 0 && isFinite(boneSimilarity)) ? (boneSimilarity / boneCount) : 0;
        const positionScore = (positionCount > 0 && isFinite(positionSimilarity)) ? (positionSimilarity / positionCount) : 0;

        // Đảm bảo tất cả điểm đều hợp lệ
        const safeAngleScore = isFinite(angleScore) ? angleScore : 0;
        const safeBoneScore = isFinite(boneScore) ? boneScore : 0;
        const safePositionScore = isFinite(positionScore) ? positionScore : 0;

        // THUẬT TOÁN CẢI TIẾN - TỐI ƯU CHO MEDIAPIPE
        
        // 1. Kiểm tra đứng im - so sánh với pose chuẩn đứng thẳng
        const standingPose = this.createStandingPose();
        const standingSimilarity = this.quickCompare(this.currentPose, standingPose);
        // Nếu giống pose đứng thẳng quá 85% → có thể đang đứng im
        if (standingSimilarity > 0.85) {
            return Math.max(0, Math.round(standingSimilarity * 30)); // Tối đa 30% nếu đứng im
        }
        
        // 2. Tính điểm cho góc khớp - ĐIỀU CHỈNH TOLERANCE CHO MEDIAPIPE
        // MediaPipe có thể có sai số ~5-10 độ, nên cần tolerance hợp lý hơn
        
        // Góc chân (quan trọng nhất)
        let legAngleScore = 0;
        let legAngleCount = 0;
        const legAngles = [[23, 25, 27], [24, 26, 28]]; // left knee, right knee
        
        legAngles.forEach(([a, b, c]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const cc = this.currentPose[c];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            
            if (ca && cb && cc && ta && tb && tc &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25 && (cc.visibility ?? 1) > 0.25) {
                const currentAngle = this.computeAngle(ca, cb, cc);
                const targetAngle = this.computeAngle(ta, tb, tc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance hợp lý cho MediaPipe: cho phép sai lệch lớn hơn một chút
                let similarity = 0;
                if (diff <= 20) {
                    similarity = 1 - (diff / 20) * 0.25; // 0-20 độ: 75-100%
                } else if (diff <= 40) {
                    similarity = 0.75 - ((diff - 20) / 20) * 0.4; // 20-40 độ: 35-75%
                } else if (diff <= 70) {
                    similarity = 0.35 - ((diff - 40) / 30) * 0.3; // 40-70 độ: 5-35%
                } else {
                    similarity = Math.max(0, 0.05 - (diff - 70) / 400); // >70 độ: 0-5%
                }
                
                legAngleScore += similarity;
                legAngleCount++;
            }
        });
        
        // Góc tay
        let armAngleScore = 0;
        let armAngleCount = 0;
        const armAngles = [[11, 13, 15], [12, 14, 16]];
        
        armAngles.forEach(([a, b, c]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const cc = this.currentPose[c];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            
            if (ca && cb && cc && ta && tb && tc &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25 && (cc.visibility ?? 1) > 0.25) {
                const currentAngle = this.computeAngle(ca, cb, cc);
                const targetAngle = this.computeAngle(ta, tb, tc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance cho tay lớn hơn một chút
                let similarity = 0;
                if (diff <= 25) {
                    similarity = 1 - (diff / 25) * 0.3;
                } else if (diff <= 50) {
                    similarity = 0.7 - ((diff - 25) / 25) * 0.5;
                } else {
                    similarity = Math.max(0, 0.2 - (diff - 50) / 250);
                }
                
                armAngleScore += similarity;
                armAngleCount++;
            }
        });
        
        const finalLegAngleScore = legAngleCount > 0 ? (legAngleScore / legAngleCount) : 0;
        const finalArmAngleScore = armAngleCount > 0 ? (armAngleScore / armAngleCount) : 0;
        
        // 3. Tỷ lệ xương - Tolerance hợp lý cho MediaPipe
        let legBoneScore = 0;
        let legBoneCount = 0;
        const legBones = [[23, 25], [25, 27], [24, 26], [26, 28]];
        
        legBones.forEach(([a, b]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const ta = targetPose[a];
            const tb = targetPose[b];
            
            if (ca && cb && ta && tb &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25) {
                const currentLen = Math.sqrt(Math.pow(ca.x - cb.x, 2) + Math.pow(ca.y - cb.y, 2));
                const targetLen = Math.sqrt(Math.pow(ta.x - tb.x, 2) + Math.pow(ta.y - tb.y, 2));
                if (targetLen > 0 && currentLen > 0) {
                    const ratio = Math.min(currentLen, targetLen) / Math.max(currentLen, targetLen);
                    // Tolerance hợp lý: tỷ lệ >= 85% được điểm cao
                    const similarity = ratio >= 0.85 ? ratio : ratio * 0.75;
                    legBoneScore += similarity;
                    legBoneCount++;
                }
            }
        });
        
        let armBoneScore = 0;
        let armBoneCount = 0;
        const armBones = [[11, 13], [13, 15], [12, 14], [14, 16]];
        
        armBones.forEach(([a, b]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const ta = targetPose[a];
            const tb = targetPose[b];
            
            if (ca && cb && ta && tb &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25) {
                const currentLen = Math.sqrt(Math.pow(ca.x - cb.x, 2) + Math.pow(ca.y - cb.y, 2));
                const targetLen = Math.sqrt(Math.pow(ta.x - tb.x, 2) + Math.pow(ta.y - tb.y, 2));
                if (targetLen > 0 && currentLen > 0) {
                    const ratio = Math.min(currentLen, targetLen) / Math.max(currentLen, targetLen);
                    const similarity = ratio >= 0.8 ? ratio : ratio * 0.65;
                    armBoneScore += similarity;
                    armBoneCount++;
                }
            }
        });
        
        const finalLegBoneScore = legBoneCount > 0 ? (legBoneScore / legBoneCount) : 0;
        const finalArmBoneScore = armBoneCount > 0 ? (armBoneScore / armBoneCount) : 0;
        
        // 4. Vị trí tương đối - Tolerance hợp lý cho MediaPipe
        const importantIndices = [23, 24, 25, 26, 27, 28, 11, 12, 13, 14, 15, 16];
        let positionScore = 0;
        let positionCount = 0;
        
        importantIndices.forEach(index => {
            const current = this.currentPose[index];
            const target = targetPose[index];
            
            if (current && target &&
                (current.visibility ?? 1) > 0.25 &&
                (target.visibility ?? 1) > 0.25) {
                const dx = current.x - target.x;
                const dy = current.y - target.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Tolerance hợp lý cho MediaPipe: cho phép sai lệch lớn hơn
                let similarity = 0;
                if (distance <= 0.15) {
                    similarity = 1 - (distance / 0.15) * 0.25; // 0-0.15: 75-100%
                } else if (distance <= 0.3) {
                    similarity = 0.75 - ((distance - 0.15) / 0.15) * 0.5; // 0.15-0.3: 25-75%
                } else {
                    similarity = Math.max(0, 0.25 - (distance - 0.3) * 0.8); // >0.3: 0-25%
                }
                
                positionScore += similarity;
                positionCount++;
            }
        });
        
        const finalPositionScore = positionCount > 0 ? (positionScore / positionCount) : 0;
        
        // 5. Kết hợp với trọng số - Chân quan trọng nhất
        let finalScore = finalLegAngleScore * 0.45 + 
                        finalLegBoneScore * 0.30 + 
                        finalArmAngleScore * 0.10 + 
                        finalArmBoneScore * 0.05 + 
                        finalPositionScore * 0.10;
        
        // 6. Penalty cho thiếu điểm nhưng không quá nghiêm ngặt
        if (legAngleCount < 2) {
            finalScore *= 0.5; // Thiếu góc chân → giảm 50%
        }
        if (legBoneCount < 4) {
            finalScore *= 0.6; // Thiếu xương chân → giảm 40%
        }
        if (armAngleCount < 1) {
            finalScore *= 0.95; // Thiếu góc tay → giảm 5%
        }
        
        // 7. Yêu cầu điểm chân tối thiểu nhưng hợp lý
        if (finalLegAngleScore < 0.5 || finalLegBoneScore < 0.6) {
            finalScore *= 0.75; // Nếu chân không đủ chính xác → giảm 25%
        }
        
        // Đảm bảo điểm hợp lệ
        if (!isFinite(finalScore) || isNaN(finalScore)) {
            finalScore = 0;
        }
        
        finalScore = Math.max(0, Math.min(1, finalScore));
        
        return Math.round(finalScore * 100);
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
     * Tạo pose chuẩn đứng thẳng để phát hiện đứng im
     */
    createStandingPose() {
        return this.createPoseTemplate({
            shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
            elbows: { y: -0.4, x: -0.2, x2: 0.2 },
            wrists: { y: -0.5, x: -0.2, x2: 0.2 },
            hips: { y: 0.1, x: -0.1, x2: 0.1 },
            knees: { y: 0.3, x: -0.1, x2: 0.1 },
            ankles: { y: 0.5, x: -0.1, x2: 0.1 }
        });
    }
    
    /**
     * So sánh nhanh để phát hiện đứng im
     */
    quickCompare(pose1, pose2) {
        if (!pose1 || !pose2) return 0;
        
        let similarity = 0;
        let count = 0;
        const indices = [11, 12, 23, 24, 25, 26, 27, 28];
        
        indices.forEach(i => {
            const p1 = pose1[i];
            const p2 = pose2[i];
            if (p1 && p2 && (p1.visibility ?? 1) > 0.3 && (p2.visibility ?? 1) > 0.3) {
                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                similarity += Math.max(0, 1 - dist * 2);
                count++;
            }
        });
        
        return count > 0 ? (similarity / count) : 0;
    }

    /**
     * Tạo pose mẫu ngẫu nhiên
     * Trả về normalized landmarks
     */
    generateRandomPose() {
        // Danh sách các pose mẫu tập trung vào CHÂN - dễ nhận diện hơn
        const poseTemplates = [
            // Pose 1: Chân rộng, tay giơ cao (dễ)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.2, x2: 0.2 },
                knees: { y: 0.3, x: -0.25, x2: 0.25 },
                ankles: { y: 0.5, x: -0.25, x2: 0.25 }
            }),
            // Pose 2: Một chân giơ cao, tay giơ cao (rất dễ nhận diện)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.3 },
                ankles: { y: 0.5, x: -0.1, x2: 0.45 }
            }),
            // Pose 3: Squat sâu, tay giơ cao (dễ nhận diện)
            this.createPoseTemplate({
                shoulders: { y: -0.2, x: -0.15, x2: 0.15 },
                elbows: { y: -0.4, x: -0.2, x2: 0.2 },
                wrists: { y: -0.6, x: -0.2, x2: 0.2 },
                hips: { y: 0.2, x: -0.1, x2: 0.1 },
                knees: { y: 0.4, x: -0.1, x2: 0.1 },
                ankles: { y: 0.5, x: -0.1, x2: 0.1 }
            }),
            // Pose 4: Chân rộng, một chân co, tay dang ngang (dễ)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.2, x2: 0.3 },
                ankles: { y: 0.5, x: -0.2, x2: 0.45 }
            }),
            // Pose 5: Lunge (chân trước sau), tay giơ cao (rất dễ)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.25, x2: 0.15 },
                ankles: { y: 0.5, x: -0.3, x2: 0.1 }
            }),
            // Pose 6: Chân rộng, một chân giơ ngang, tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.2, x2: 0.25 },
                ankles: { y: 0.5, x: -0.2, x2: 0.4 }
            }),
            // Pose 7: Một chân giơ cao về phía sau, tay dang ngang
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.3, x2: 0.3 },
                elbows: { y: -0.3, x: -0.4, x2: 0.4 },
                wrists: { y: -0.3, x: -0.5, x2: 0.5 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.25 },
                ankles: { y: 0.5, x: -0.1, x2: 0.35 }
            }),
            // Pose 8: Chân rộng, squat nhẹ, tay dang ngang
            this.createPoseTemplate({
                shoulders: { y: -0.25, x: -0.3, x2: 0.3 },
                elbows: { y: -0.25, x: -0.4, x2: 0.4 },
                wrists: { y: -0.25, x: -0.5, x2: 0.5 },
                hips: { y: 0.15, x: -0.2, x2: 0.2 },
                knees: { y: 0.35, x: -0.25, x2: 0.25 },
                ankles: { y: 0.5, x: -0.25, x2: 0.25 }
            }),
            // Pose 9: Một chân giơ cao, một chân co, tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.15, x2: 0.3 },
                ankles: { y: 0.5, x: -0.15, x2: 0.45 }
            }),
            // Pose 10: Chân rộng, một chân co cao, tay giơ cao
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.5, x: -0.2, x2: 0.2 },
                wrists: { y: -0.7, x: -0.2, x2: 0.2 },
                hips: { y: 0.1, x: -0.2, x2: 0.2 },
                knees: { y: 0.3, x: -0.25, x2: 0.35 },
                ankles: { y: 0.5, x: -0.25, x2: 0.5 }
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

