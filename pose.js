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
            throw new Error('MediaPipe Pose chưa được load. Vui lòng kiểm tra kết nối internet và reload trang.');
        }

        // Cấu hình MediaPipe Pose
        this.pose = new Pose({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
            }
        });

        // Cấu hình MediaPipe - cân bằng giữa độ chính xác và hiệu năng
        this.pose.setOptions({
            modelComplexity: 1, // Giảm xuống 1 để đảm bảo chạy mượt (2 có thể quá nặng)
            smoothLandmarks: true, // Làm mượt landmarks để giảm nhiễu
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.5, // Giảm xuống 0.5 để nhận diện tốt hơn
            minTrackingConfidence: 0.5 // Giảm xuống 0.5 để tracking tốt hơn
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
            // Đảm bảo canvas có kích thước hợp lệ
            if (!this.canvasElement || !this.canvasCtx) {
                return;
            }
            
            if (this.canvasElement.width === 0 || this.canvasElement.height === 0) {
                // Setup lại canvas nếu chưa có kích thước
                const wrapper = this.canvasElement.parentElement;
                if (wrapper) {
                    this.canvasElement.width = wrapper.offsetWidth || 640;
                    this.canvasElement.height = wrapper.offsetHeight || 480;
                } else {
                    return;
                }
            }
            
            // Vẽ video frame
            this.canvasCtx.save();
            this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            
            // Vẽ image từ MediaPipe
            if (results.image) {
                this.canvasCtx.drawImage(
                    results.image, 0, 0, 
                    this.canvasElement.width, 
                    this.canvasElement.height
                );
            }

            // Vẽ skeleton nếu có pose
            if (results.poseLandmarks && results.poseLandmarks.length > 0) {
                try {
                    // Lọc landmarks có visibility thấp và làm mượt
                    const filteredLandmarks = this.filterAndSmoothLandmarks(results.poseLandmarks);
                    this.currentPose = this.normalizeLandmarks(filteredLandmarks);
                    
                    // Vẽ bounding frame và skeleton
                    this.drawBoundingFrame(results.poseLandmarks, this.canvasCtx);
                    this.drawPose(results.poseLandmarks, this.canvasCtx);
                } catch (error) {
                    console.error('Lỗi khi vẽ skeleton:', error);
                    // Vẫn vẽ skeleton cơ bản nếu có lỗi
                    if (results.poseLandmarks) {
                        this.drawPose(results.poseLandmarks, this.canvasCtx);
                    }
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
        if (!landmarks || !ctx || !this.canvasElement) return;
        
        const connections = [
            // Face
            [0, 1], [1, 2], [2, 3], [3, 7],
            // Upper body
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24],
            // Lower body
            [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
        ];

        const canvasWidth = this.canvasElement.width;
        const canvasHeight = this.canvasElement.height;
        
        if (canvasWidth === 0 || canvasHeight === 0) return;

        // Vẽ connections
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 4;
        connections.forEach(([start, end]) => {
            const startPoint = landmarks[start];
            const endPoint = landmarks[end];
            if (startPoint && endPoint && 
                (startPoint.visibility ?? 1) > 0.3 &&
                (endPoint.visibility ?? 1) > 0.3) {
                ctx.beginPath();
                ctx.moveTo(
                    startPoint.x * canvasWidth,
                    startPoint.y * canvasHeight
                );
                ctx.lineTo(
                    endPoint.x * canvasWidth,
                    endPoint.y * canvasHeight
                );
                ctx.stroke();
            }
        });

        // Vẽ keypoints
        ctx.fillStyle = '#ff0000';
        landmarks.forEach((landmark) => {
            if (landmark && (landmark.visibility ?? 1) > 0.3) {
                ctx.beginPath();
                ctx.arc(
                    landmark.x * canvasWidth,
                    landmark.y * canvasHeight,
                    6, 0, 2 * Math.PI
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

        if (!this.videoElement || !this.canvasElement) {
            throw new Error('Video hoặc Canvas element chưa được thiết lập');
        }

        // Đảm bảo canvas có kích thước
        if (this.canvasElement.width === 0 || this.canvasElement.height === 0) {
            const wrapper = this.canvasElement.parentElement;
            if (wrapper) {
                this.canvasElement.width = wrapper.offsetWidth || 640;
                this.canvasElement.height = wrapper.offsetHeight || 480;
            }
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
                const checkReady = () => {
                    if (this.videoElement.readyState >= 2) {
                        resolve();
                    } else {
                        setTimeout(checkReady, 100);
                    }
                };
                this.videoElement.onloadedmetadata = () => {
                    if (this.videoElement.readyState >= 2) {
                        resolve();
                    } else {
                        checkReady();
                    }
                };
                // Timeout sau 5 giây
                setTimeout(() => {
                    if (this.videoElement.readyState < 2) {
                        console.warn('Video chưa sẵn sàng sau 5 giây, tiếp tục...');
                        resolve();
                    }
                }, 5000);
            }
        });

        this.isRunning = true;

        const processFrame = async () => {
            if (!this.isRunning) return;

            try {
                if (this.videoElement && 
                    this.videoElement.readyState >= this.videoElement.HAVE_ENOUGH_DATA &&
                    this.pose) {
                    await this.pose.send({ image: this.videoElement });
                }
            } catch (error) {
                console.error('Lỗi khi gửi frame đến MediaPipe:', error);
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

            // THUẬT TOÁN CẢI TIẾN - CHỈ TÍNH ĐIỂM CHO CÁC PHẦN KHÁC VỚI ĐỨNG THẲNG
        
        // 1. Kiểm tra đứng im - so sánh với pose chuẩn đứng thẳng
        const standingPose = this.createStandingPose();
        const standingSimilarity = this.quickCompare(this.currentPose, standingPose);
        // Nếu giống pose đứng thẳng quá 90% → có thể đang đứng im
        if (standingSimilarity > 0.90) {
            return Math.max(0, Math.round(standingSimilarity * 20)); // Tối đa 20% nếu đứng im
        }
        
        // 2. So sánh target pose với standing pose để xác định phần nào khác với đứng thẳng
        const targetVsStanding = this.compareTargetWithStanding(targetPose, standingPose);
        
        // 3. Tính điểm cho góc khớp - CHỈ TÍNH CHO CÁC PHẦN KHÁC VỚI ĐỨNG THẲNG
        
        // Góc chân (quan trọng nhất) - CHỈ TÍNH NẾU TARGET KHÁC VỚI ĐỨNG THẲNG
        let legAngleScore = 0;
        let legAngleCount = 0;
        let legAngleWeight = 0; // Tổng trọng số của các góc chân cần kiểm tra
        const legAngles = [[23, 25, 27], [24, 26, 28]]; // left knee, right knee
        
        legAngles.forEach(([a, b, c], index) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const cc = this.currentPose[c];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            const sa = standingPose[a];
            const sb = standingPose[b];
            const sc = standingPose[c];
            
            if (ca && cb && cc && ta && tb && tc && sa && sb && sc &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25 && (cc.visibility ?? 1) > 0.25) {
                
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const angleDiffFromStanding = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = angleDiffFromStanding > 180 ? 360 - angleDiffFromStanding : angleDiffFromStanding;
                
                // Nếu target pose có chân đứng thẳng (góc gần với standing < 12 độ), không tính điểm chân này
                if (normalizedDiff < 12) {
                    // Không tính điểm cho chân này vì nó giống đứng thẳng
                    return;
                }
                
                // Chân này khác với đứng thẳng, cần kiểm tra
                legAngleWeight += 1;
                
                const currentAngle = this.computeAngle(ca, cb, cc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance nới lỏng hơn để dễ đạt điểm hơn
                let similarity = 0;
                if (diff <= 25) {
                    similarity = 1 - (diff / 25) * 0.15; // 0-25 độ: 85-100%
                } else if (diff <= 45) {
                    similarity = 0.85 - ((diff - 25) / 20) * 0.35; // 25-45 độ: 50-85%
                } else if (diff <= 70) {
                    similarity = 0.5 - ((diff - 45) / 25) * 0.35; // 45-70 độ: 15-50%
                } else {
                    similarity = Math.max(0, 0.15 - (diff - 70) / 400); // >70 độ: 0-15%
                }
                
                legAngleScore += similarity;
                legAngleCount++;
            }
        });
        
        // Góc tay - CHỈ TÍNH NẾU TARGET KHÁC VỚI ĐỨNG THẲNG
        let armAngleScore = 0;
        let armAngleCount = 0;
        let armAngleWeight = 0;
        const armAngles = [[11, 13, 15], [12, 14, 16]];
        
        armAngles.forEach(([a, b, c]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const cc = this.currentPose[c];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            const sa = standingPose[a];
            const sb = standingPose[b];
            const sc = standingPose[c];
            
            if (ca && cb && cc && ta && tb && tc && sa && sb && sc &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25 && (cc.visibility ?? 1) > 0.25) {
                
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const angleDiffFromStanding = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = angleDiffFromStanding > 180 ? 360 - angleDiffFromStanding : angleDiffFromStanding;
                
                // Nếu target pose có tay đứng thẳng (góc gần với standing < 18 độ), không tính điểm tay này
                if (normalizedDiff < 18) {
                    return;
                }
                
                // Tay này khác với đứng thẳng, cần kiểm tra
                armAngleWeight += 1;
                
                const currentAngle = this.computeAngle(ca, cb, cc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance nới lỏng hơn để dễ đạt điểm hơn
                let similarity = 0;
                if (diff <= 30) {
                    similarity = 1 - (diff / 30) * 0.2; // 0-30 độ: 80-100%
                } else if (diff <= 55) {
                    similarity = 0.8 - ((diff - 30) / 25) * 0.4; // 30-55 độ: 40-80%
                } else {
                    similarity = Math.max(0, 0.4 - (diff - 55) / 200); // >55 độ: 0-40%
                }
                
                armAngleScore += similarity;
                armAngleCount++;
            }
        });
        
        const finalLegAngleScore = legAngleCount > 0 ? (legAngleScore / legAngleCount) : 0;
        const finalArmAngleScore = armAngleCount > 0 ? (armAngleScore / armAngleCount) : 0;
        
        // 4. Tỷ lệ xương - CHỈ TÍNH CHO CÁC PHẦN KHÁC VỚI ĐỨNG THẲNG
        let legBoneScore = 0;
        let legBoneCount = 0;
        let legBoneWeight = 0;
        const legBones = [[23, 25], [25, 27], [24, 26], [26, 28]];
        
        legBones.forEach(([a, b]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const sa = standingPose[a];
            const sb = standingPose[b];
            
            if (ca && cb && ta && tb && sa && sb &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25) {
                
                const targetLen = Math.sqrt(Math.pow(ta.x - tb.x, 2) + Math.pow(ta.y - tb.y, 2));
                const standingLen = Math.sqrt(Math.pow(sa.x - sb.x, 2) + Math.pow(sa.y - sb.y, 2));
                
                // Nếu tỷ lệ xương target gần với standing (< 10% khác biệt), không tính điểm
                if (standingLen > 0 && targetLen > 0) {
                    const ratio = Math.min(targetLen, standingLen) / Math.max(targetLen, standingLen);
                    if (ratio > 0.9) {
                        // Xương này giống đứng thẳng, không tính điểm
                        return;
                    }
                }
                
                // Xương này khác với đứng thẳng, cần kiểm tra
                legBoneWeight += 1;
                
                const currentLen = Math.sqrt(Math.pow(ca.x - cb.x, 2) + Math.pow(ca.y - cb.y, 2));
                if (targetLen > 0 && currentLen > 0) {
                    const ratio = Math.min(currentLen, targetLen) / Math.max(currentLen, targetLen);
                    // Nới lỏng tolerance cho xương chân
                    const similarity = ratio >= 0.8 ? ratio : ratio * 0.85;
                    legBoneScore += similarity;
                    legBoneCount++;
                }
            }
        });
        
        let armBoneScore = 0;
        let armBoneCount = 0;
        let armBoneWeight = 0;
        const armBones = [[11, 13], [13, 15], [12, 14], [14, 16]];
        
        armBones.forEach(([a, b]) => {
            const ca = this.currentPose[a];
            const cb = this.currentPose[b];
            const ta = targetPose[a];
            const tb = targetPose[b];
            const sa = standingPose[a];
            const sb = standingPose[b];
            
            if (ca && cb && ta && tb && sa && sb &&
                (ca.visibility ?? 1) > 0.25 && (cb.visibility ?? 1) > 0.25) {
                
                const targetLen = Math.sqrt(Math.pow(ta.x - tb.x, 2) + Math.pow(ta.y - tb.y, 2));
                const standingLen = Math.sqrt(Math.pow(sa.x - sb.x, 2) + Math.pow(sa.y - sb.y, 2));
                
                // Nếu tỷ lệ xương target gần với standing (< 15% khác biệt), không tính điểm
                if (standingLen > 0 && targetLen > 0) {
                    const ratio = Math.min(targetLen, standingLen) / Math.max(targetLen, standingLen);
                    if (ratio > 0.85) {
                        // Xương này giống đứng thẳng, không tính điểm
                        return;
                    }
                }
                
                // Xương này khác với đứng thẳng, cần kiểm tra
                armBoneWeight += 1;
                
                const currentLen = Math.sqrt(Math.pow(ca.x - cb.x, 2) + Math.pow(ca.y - cb.y, 2));
                if (targetLen > 0 && currentLen > 0) {
                    const ratio = Math.min(currentLen, targetLen) / Math.max(currentLen, targetLen);
                    // Nới lỏng tolerance cho xương tay
                    const similarity = ratio >= 0.75 ? ratio : ratio * 0.75;
                    armBoneScore += similarity;
                    armBoneCount++;
                }
            }
        });
        
        const finalLegBoneScore = legBoneCount > 0 ? (legBoneScore / legBoneCount) : 0;
        const finalArmBoneScore = armBoneCount > 0 ? (armBoneScore / armBoneCount) : 0;
        
        // 5. Kết hợp với trọng số - CHỈ TÍNH CÁC PHẦN KHÁC VỚI ĐỨNG THẲNG
        // Tính tổng trọng số dựa trên số phần cần kiểm tra
        const totalWeight = legAngleWeight + legBoneWeight + armAngleWeight + armBoneWeight;
        
        if (totalWeight === 0) {
            // Nếu không có phần nào khác với đứng thẳng, trả về điểm thấp
            return Math.round(standingSimilarity * 30);
        }
        
        // Tính điểm dựa trên tỷ lệ các phần cần kiểm tra
        const legWeight = (legAngleWeight + legBoneWeight) / totalWeight;
        const armWeight = (armAngleWeight + armBoneWeight) / totalWeight;
        
        let finalScore = 0;
        
        if (legAngleWeight > 0 || legBoneWeight > 0) {
            const legScore = (finalLegAngleScore * legAngleWeight + finalLegBoneScore * legBoneWeight) / 
                           (legAngleWeight + legBoneWeight);
            finalScore += legScore * legWeight * 0.7; // Chân chiếm 70% trọng số
        }
        
        if (armAngleWeight > 0 || armBoneWeight > 0) {
            const armScore = (finalArmAngleScore * armAngleWeight + finalArmBoneScore * armBoneWeight) / 
                           (armAngleWeight + armBoneWeight);
            finalScore += armScore * armWeight * 0.3; // Tay chiếm 30% trọng số
        }
        
        // 6. Penalty nhẹ hơn cho thiếu điểm các phần cần kiểm tra
        if (legAngleWeight > 0 && legAngleCount === 0) {
            finalScore *= 0.5; // Thiếu góc chân cần kiểm tra → giảm 50%
        }
        if (legBoneWeight > 0 && legBoneCount === 0) {
            finalScore *= 0.6; // Thiếu xương chân cần kiểm tra → giảm 40%
        }
        if (armAngleWeight > 0 && armAngleCount === 0) {
            finalScore *= 0.7; // Thiếu góc tay cần kiểm tra → giảm 30%
        }
        if (armBoneWeight > 0 && armBoneCount === 0) {
            finalScore *= 0.8; // Thiếu xương tay cần kiểm tra → giảm 20%
        }
        
        // 7. Yêu cầu điểm tối thiểu nhẹ hơn cho các phần cần kiểm tra
        if (legAngleWeight > 0 && finalLegAngleScore < 0.4) {
            finalScore *= 0.85; // Chân không đủ chính xác → giảm 15%
        }
        if (legBoneWeight > 0 && finalLegBoneScore < 0.5) {
            finalScore *= 0.85; // Xương chân không đủ chính xác → giảm 15%
        }
        
        // 8. Bonus điểm nếu làm gần đúng (tăng điểm cho các phần gần đúng)
        if (legAngleWeight > 0 && finalLegAngleScore > 0.5) {
            finalScore *= 1.1; // Bonus 10% nếu chân làm tốt
        }
        if (armAngleWeight > 0 && finalArmAngleScore > 0.5) {
            finalScore *= 1.05; // Bonus 5% nếu tay làm tốt
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
     * So sánh target pose với standing pose để xác định phần nào khác với đứng thẳng
     */
    compareTargetWithStanding(targetPose, standingPose) {
        const result = {
            legDifferent: false,
            armDifferent: false,
            legAngleCount: 0,
            armAngleCount: 0
        };
        
        // Kiểm tra chân
        const legAngles = [[23, 25, 27], [24, 26, 28]];
        legAngles.forEach(([a, b, c]) => {
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            const sa = standingPose[a];
            const sb = standingPose[b];
            const sc = standingPose[c];
            
            if (ta && tb && tc && sa && sb && sc) {
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const diff = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = diff > 180 ? 360 - diff : diff;
                
                if (normalizedDiff >= 12) {
                    result.legDifferent = true;
                    result.legAngleCount++;
                }
            }
        });
        
        // Kiểm tra tay
        const armAngles = [[11, 13, 15], [12, 14, 16]];
        armAngles.forEach(([a, b, c]) => {
            const ta = targetPose[a];
            const tb = targetPose[b];
            const tc = targetPose[c];
            const sa = standingPose[a];
            const sb = standingPose[b];
            const sc = standingPose[c];
            
            if (ta && tb && tc && sa && sb && sc) {
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const diff = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = diff > 180 ? 360 - diff : diff;
                
                if (normalizedDiff >= 18) {
                    result.armDifferent = true;
                    result.armAngleCount++;
                }
            }
        });
        
        return result;
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

