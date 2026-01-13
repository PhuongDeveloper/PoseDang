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

            // THUẬT TOÁN ĐƠN GIẢN HÓA - SO SÁNH TỔNG THỂ HÌNH DÁNG SKELETON
        
        // 1. Kiểm tra đứng im - so sánh với pose chuẩn đứng thẳng
        const standingPose = this.createStandingPose();
        const standingSimilarity = this.quickCompare(this.currentPose, standingPose);
        // Nếu giống pose đứng thẳng quá 92% → có thể đang đứng im
        if (standingSimilarity > 0.92) {
            return Math.max(0, Math.round(standingSimilarity * 15)); // Tối đa 15% nếu đứng im
        }
        
        // 2. So sánh tổng thể hình dáng skeleton - ĐƠN GIẢN HÓA
        // So sánh các điểm quan trọng: vai, hông, đầu gối, cổ tay, mắt cá chân
        const importantPoints = [
            [11, 12], // Shoulders
            [23, 24], // Hips
            [25, 26], // Knees
            [27, 28], // Ankles
            [15, 16], // Wrists
            [13, 14]  // Elbows
        ];
        
        let totalScore = 0;
        let totalWeight = 0;
        
        // So sánh từng cặp điểm đối xứng
        importantPoints.forEach(([leftIdx, rightIdx]) => {
            const currentLeft = this.currentPose[leftIdx];
            const currentRight = this.currentPose[rightIdx];
            const targetLeft = targetPose[leftIdx];
            const targetRight = targetPose[rightIdx];
            const standingLeft = standingPose[leftIdx];
            const standingRight = standingPose[rightIdx];
            
            // Kiểm tra visibility
            if (currentLeft && currentRight && targetLeft && targetRight && 
                standingLeft && standingRight &&
                (currentLeft.visibility ?? 1) > 0.2 && 
                (currentRight.visibility ?? 1) > 0.2) {
                
                // Tính khoảng cách giữa 2 điểm (chiều rộng)
                const currentWidth = Math.abs(currentLeft.x - currentRight.x);
                const targetWidth = Math.abs(targetLeft.x - targetRight.x);
                const standingWidth = Math.abs(standingLeft.x - standingRight.x);
                
                // Tính chiều cao trung bình
                const currentAvgY = (currentLeft.y + currentRight.y) / 2;
                const targetAvgY = (targetLeft.y + targetRight.y) / 2;
                const standingAvgY = (standingLeft.y + standingRight.y) / 2;
                
                // Kiểm tra xem target có khác với standing không
                const widthDiffFromStanding = Math.abs(targetWidth - standingWidth);
                const heightDiffFromStanding = Math.abs(targetAvgY - standingAvgY);
                
                // Nếu target quá giống standing (chiều rộng và chiều cao gần như nhau), không tính điểm
                if (widthDiffFromStanding < 0.05 && heightDiffFromStanding < 0.05) {
                    return; // Không tính điểm cho phần này vì giống đứng thẳng
                }
                
                // Tính điểm cho phần này
                totalWeight += 1;
                
                // So sánh chiều rộng - chặt hơn một chút
                let widthScore = 0;
                if (targetWidth > 0 && currentWidth > 0) {
                    const widthRatio = Math.min(currentWidth, targetWidth) / Math.max(currentWidth, targetWidth);
                    widthScore = widthRatio >= 0.75 ? widthRatio * 0.95 : widthRatio * 0.75; // Giảm điểm một chút
                }
                
                // So sánh chiều cao - chặt hơn một chút
                let heightScore = 0;
                const heightDiff = Math.abs(currentAvgY - targetAvgY);
                if (heightDiff <= 0.1) {
                    heightScore = (1 - (heightDiff / 0.1) * 0.2) * 0.95; // 0-0.1: 76-95% (giảm 5%)
                } else if (heightDiff <= 0.2) {
                    heightScore = (0.8 - ((heightDiff - 0.1) / 0.1) * 0.4) * 0.95; // 0.1-0.2: 38-76%
                } else if (heightDiff <= 0.3) {
                    heightScore = (0.4 - ((heightDiff - 0.2) / 0.1) * 0.3) * 0.95; // 0.2-0.3: 9.5-38%
                } else {
                    heightScore = Math.max(0, (0.1 - (heightDiff - 0.3) * 0.3) * 0.95); // >0.3: 0-9.5%
                }
                
                // Điểm trung bình cho cặp điểm này
                const pairScore = (widthScore + heightScore) / 2;
                totalScore += pairScore;
            }
        });
        
        // 3. So sánh góc chân và tay (đơn giản hóa)
        const legAngles = [[23, 25, 27], [24, 26, 28]];
        let legScore = 0;
        let legCount = 0;
        
        legAngles.forEach(([a, b, c]) => {
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
                (ca.visibility ?? 1) > 0.2 && (cb.visibility ?? 1) > 0.2 && (cc.visibility ?? 1) > 0.2) {
                
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const angleDiffFromStanding = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = angleDiffFromStanding > 180 ? 360 - angleDiffFromStanding : angleDiffFromStanding;
                
                // Nếu target có chân đứng thẳng (< 10 độ), không tính điểm
                if (normalizedDiff < 10) {
                    return;
                }
                
                legCount++;
                const currentAngle = this.computeAngle(ca, cb, cc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance chặt hơn một chút để giảm điểm
                let similarity = 0;
                if (diff <= 35) {
                    similarity = (1 - (diff / 35) * 0.1) * 0.93; // 0-35 độ: 84-93% (giảm 7%)
                } else if (diff <= 60) {
                    similarity = (0.9 - ((diff - 35) / 25) * 0.3) * 0.93; // 35-60 độ: 56-84%
                } else if (diff <= 90) {
                    similarity = (0.6 - ((diff - 60) / 30) * 0.4) * 0.93; // 60-90 độ: 19-56%
                } else {
                    similarity = Math.max(0, (0.2 - (diff - 90) / 300) * 0.93); // >90 độ: 0-19%
                }
                
                legScore += similarity;
            }
        });
        
        const finalLegScore = legCount > 0 ? (legScore / legCount) : 0;
        
        // 4. So sánh góc tay
        const armAngles = [[11, 13, 15], [12, 14, 16]];
        let armScore = 0;
        let armCount = 0;
        
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
                (ca.visibility ?? 1) > 0.2 && (cb.visibility ?? 1) > 0.2 && (cc.visibility ?? 1) > 0.2) {
                
                const targetAngle = this.computeAngle(ta, tb, tc);
                const standingAngle = this.computeAngle(sa, sb, sc);
                const angleDiffFromStanding = Math.abs(targetAngle - standingAngle);
                const normalizedDiff = angleDiffFromStanding > 180 ? 360 - angleDiffFromStanding : angleDiffFromStanding;
                
                // Nếu target có tay đứng thẳng (< 15 độ), không tính điểm
                if (normalizedDiff < 15) {
                    return;
                }
                
                armCount++;
                const currentAngle = this.computeAngle(ca, cb, cc);
                let diff = Math.abs(currentAngle - targetAngle);
                if (diff > 180) diff = 360 - diff;
                
                // Tolerance chặt hơn một chút để giảm điểm
                let similarity = 0;
                if (diff <= 40) {
                    similarity = (1 - (diff / 40) * 0.15) * 0.93; // 0-40 độ: 79-93% (giảm 7%)
                } else if (diff <= 70) {
                    similarity = (0.85 - ((diff - 40) / 30) * 0.35) * 0.93; // 40-70 độ: 47-79%
                } else {
                    similarity = Math.max(0, (0.5 - (diff - 70) / 200) * 0.93); // >70 độ: 0-47%
                }
                
                armScore += similarity;
            }
        });
        
        const finalArmScore = armCount > 0 ? (armScore / armCount) : 0;
        
        // 5. Tính điểm tổng thể
        let finalScore = 0;
        
        // Điểm từ so sánh hình dáng tổng thể (60%)
        if (totalWeight > 0) {
            const shapeScore = totalScore / totalWeight;
            finalScore += shapeScore * 0.6;
        }
        
        // Điểm từ góc chân (30%)
        if (legCount > 0) {
            finalScore += finalLegScore * 0.3;
        }
        
        // Điểm từ góc tay (10%)
        if (armCount > 0) {
            finalScore += finalArmScore * 0.1;
        }
        
        // 6. Nếu không có phần nào khác với đứng thẳng, trả về điểm thấp
        if (totalWeight === 0 && legCount === 0 && armCount === 0) {
            return Math.round(standingSimilarity * 20);
        }
        
        // 7. Bonus nếu làm tốt - giảm bonus để khó hơn
        if (finalScore > 0.5) {
            finalScore *= 1.08; // Bonus 8% nếu làm tốt (giảm từ 15% xuống 8%)
        }
        
        // 8. Giảm điểm tổng thể thêm một chút để khó hơn
        finalScore *= 0.96; // Giảm thêm 4% điểm tổng thể
        
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
        // DANH SÁCH 20 POSE KHÓ - YÊU CẦU NHIỀU BỘ PHẬN CÙNG DI CHUYỂN
        // Tất cả đều có góc lớn, khó thực hiện, dễ phân biệt với đứng thẳng
        const poseTemplates = [
            // Pose 1: TAY GIƠ CAO + CHÂN RỘNG CỰC ĐẠI + SQUAT (Super wide squat arms up)
            this.createPoseTemplate({
                shoulders: { y: -0.2, x: -0.15, x2: 0.15 },
                elbows: { y: -0.65, x: -0.2, x2: 0.2 },
                wrists: { y: -0.9, x: -0.2, x2: 0.2 }, // Tay giơ cực cao
                hips: { y: 0.22, x: -0.35, x2: 0.35 }, // Chân cực rộng
                knees: { y: 0.42, x: -0.4, x2: 0.4 }, // Đầu gối cực rộng + squat
                ankles: { y: 0.5, x: -0.4, x2: 0.4 }
            }),
            
            // Pose 2: MỘT CHÂN GIƠ CAO VỀ TRƯỚC + TAY DANG NGANG CỰC RỘNG (High kick T-pose)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.45 }, // Chân phải giơ rất cao
                ankles: { y: 0.5, x: -0.1, x2: 0.6 } // Mắt cá chân phải cực cao
            }),
            
            // Pose 3: SQUAT CỰC SÂU + TAY GIƠ CAO + CHÂN RỘNG (Ultra deep squat)
            this.createPoseTemplate({
                shoulders: { y: -0.1, x: -0.15, x2: 0.15 }, // Người rất thấp
                elbows: { y: -0.55, x: -0.2, x2: 0.2 },
                wrists: { y: -0.8, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.3, x: -0.2, x2: 0.2 }, // Hông rất thấp
                knees: { y: 0.48, x: -0.15, x2: 0.15 }, // Đầu gối rất thấp
                ankles: { y: 0.5, x: -0.15, x2: 0.15 }
            }),
            
            // Pose 4: TAY DANG NGANG CỰC RỘNG + CHÂN RỘNG + MỘT CHÂN CO CAO (Warrior extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.25, x2: 0.25 }, // Chân rộng
                knees: { y: 0.3, x: -0.3, x2: 0.4 }, // Chân phải co cao
                ankles: { y: 0.5, x: -0.3, x2: 0.55 }
            }),
            
            // Pose 5: LUNGE CỰC SÂU + TAY GIƠ CAO + CHÂN SAU CO (Ultra deep lunge)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.65, x: -0.2, x2: 0.2 },
                wrists: { y: -0.85, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.1, x: -0.25, x2: 0.25 },
                knees: { y: 0.3, x: -0.4, x2: 0.2 }, // Chân trái cực xa
                ankles: { y: 0.5, x: -0.45, x2: 0.15 } // Mắt cá chân trái cực xa
            }),
            
            // Pose 6: MỘT CHÂN GIƠ NGANG CAO + TAY GIƠ CAO + CHÂN ĐỨNG RỘNG (Side kick extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.65, x: -0.2, x2: 0.2 },
                wrists: { y: -0.85, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.1, x: -0.2, x2: 0.2 }, // Chân rộng
                knees: { y: 0.3, x: -0.25, x2: 0.35 }, // Chân phải giơ ngang cao
                ankles: { y: 0.5, x: -0.25, x2: 0.5 } // Mắt cá chân phải ngang cao
            }),
            
            // Pose 7: TAY DANG NGANG CỰC RỘNG + MỘT CHÂN GIƠ VỀ SAU CAO (Balancing extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.1, x2: 0.1 },
                knees: { y: 0.3, x: -0.1, x2: 0.35 }, // Chân phải giơ về sau cao
                ankles: { y: 0.5, x: -0.1, x2: 0.45 } // Mắt cá chân phải cao
            }),
            
            // Pose 8: CHÂN RỘNG CỰC ĐẠI + SQUAT SÂU + TAY DANG NGANG (Ultra wide squat)
            this.createPoseTemplate({
                shoulders: { y: -0.2, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.2, x: -0.5, x2: 0.5 },
                wrists: { y: -0.2, x: -0.6, x2: 0.6 },
                hips: { y: 0.25, x: -0.35, x2: 0.35 }, // Chân cực rộng
                knees: { y: 0.45, x: -0.4, x2: 0.4 }, // Đầu gối cực rộng + squat sâu
                ankles: { y: 0.5, x: -0.4, x2: 0.4 }
            }),
            
            // Pose 9: MỘT CHÂN CO CỰC CAO + TAY GIƠ CAO + CHÂN ĐỨNG RỘNG (Ultra high knee)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.65, x: -0.2, x2: 0.2 },
                wrists: { y: -0.85, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.1, x: -0.2, x2: 0.2 }, // Chân rộng
                knees: { y: 0.3, x: -0.2, x2: 0.45 }, // Chân phải co cực cao
                ankles: { y: 0.5, x: -0.2, x2: 0.6 } // Mắt cá chân phải cực cao
            }),
            
            // Pose 10: TAY GIƠ CAO + CHÂN RỘNG CỰC ĐẠI + MỘT CHÂN CO (Star extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.7, x: -0.2, x2: 0.2 },
                wrists: { y: -0.9, x: -0.2, x2: 0.2 }, // Tay giơ cực cao
                hips: { y: 0.1, x: -0.3, x2: 0.3 }, // Chân cực rộng
                knees: { y: 0.3, x: -0.35, x2: 0.4 }, // Chân phải co cao
                ankles: { y: 0.5, x: -0.35, x2: 0.55 }
            }),
            
            // Pose 11: TAY DANG NGANG CỰC RỘNG + CHÂN RỘNG + SQUAT SÂU (T-pose squat extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.15, x: -0.45, x2: 0.45 }, // Tay dang cực cực rộng
                elbows: { y: -0.15, x: -0.55, x2: 0.55 },
                wrists: { y: -0.15, x: -0.65, x2: 0.65 },
                hips: { y: 0.25, x: -0.3, x2: 0.3 }, // Chân rộng
                knees: { y: 0.45, x: -0.35, x2: 0.35 }, // Squat sâu
                ankles: { y: 0.5, x: -0.35, x2: 0.35 }
            }),
            
            // Pose 12: MỘT CHÂN GIƠ VỀ TRƯỚC CAO + TAY DANG NGANG CỰC RỘNG (Forward kick T extreme)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.15, x2: 0.15 },
                knees: { y: 0.3, x: -0.15, x2: 0.4 }, // Chân phải giơ về trước cao
                ankles: { y: 0.5, x: -0.15, x2: 0.55 }
            }),
            
            // Pose 13: TAY MỘT BÊN GIƠ CAO + CHÂN RỘNG + MỘT CHÂN CO (Asymmetric pose)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.3, x: -0.2, x2: -0.6 }, // Tay trái ngang, tay phải cao
                wrists: { y: -0.3, x: -0.2, x2: -0.85 }, // Cổ tay trái ngang, phải cao
                hips: { y: 0.1, x: -0.25, x2: 0.25 }, // Chân rộng
                knees: { y: 0.3, x: -0.3, x2: 0.35 }, // Chân phải co
                ankles: { y: 0.5, x: -0.3, x2: 0.5 }
            }),
            
            // Pose 14: TAY DANG NGANG + CHÂN RỘNG + MỘT CHÂN GIƠ VỀ SAU CAO (Back kick T-pose)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.2, x2: 0.2 }, // Chân rộng
                knees: { y: 0.3, x: -0.25, x2: 0.3 }, // Chân phải giơ về sau
                ankles: { y: 0.5, x: -0.25, x2: 0.4 } // Mắt cá chân phải cao
            }),
            
            // Pose 15: SQUAT SÂU + TAY DANG NGANG CỰC RỘNG + CHÂN RỘNG (Deep squat T-pose)
            this.createPoseTemplate({
                shoulders: { y: -0.1, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.1, x: -0.5, x2: 0.5 },
                wrists: { y: -0.1, x: -0.6, x2: 0.6 },
                hips: { y: 0.28, x: -0.25, x2: 0.25 }, // Hông thấp
                knees: { y: 0.46, x: -0.2, x2: 0.2 }, // Đầu gối thấp
                ankles: { y: 0.5, x: -0.2, x2: 0.2 }
            }),
            
            // Pose 16: TAY GIƠ CAO + LUNGE SÂU + CHÂN SAU CO (Lunge arms up)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.65, x: -0.2, x2: 0.2 },
                wrists: { y: -0.85, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.1, x: -0.2, x2: 0.2 },
                knees: { y: 0.3, x: -0.38, x2: 0.18 }, // Chân trái xa
                ankles: { y: 0.5, x: -0.42, x2: 0.12 } // Mắt cá chân trái xa
            }),
            
            // Pose 17: CHÂN RỘNG CỰC ĐẠI + TAY GIƠ CAO + MỘT CHÂN CO (Wide star)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.15, x2: 0.15 },
                elbows: { y: -0.7, x: -0.2, x2: 0.2 },
                wrists: { y: -0.9, x: -0.2, x2: 0.2 }, // Tay giơ cực cao
                hips: { y: 0.1, x: -0.32, x2: 0.32 }, // Chân cực rộng
                knees: { y: 0.3, x: -0.37, x2: 0.4 }, // Chân phải co
                ankles: { y: 0.5, x: -0.37, x2: 0.55 }
            }),
            
            // Pose 18: TAY DANG NGANG + CHÂN RỘNG + MỘT CHÂN GIƠ NGANG CAO (Side kick wide)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.4, x2: 0.4 }, // Tay dang cực rộng
                elbows: { y: -0.3, x: -0.5, x2: 0.5 },
                wrists: { y: -0.3, x: -0.6, x2: 0.6 },
                hips: { y: 0.1, x: -0.25, x2: 0.25 }, // Chân rộng
                knees: { y: 0.3, x: -0.3, x2: 0.35 }, // Chân phải giơ ngang cao
                ankles: { y: 0.5, x: -0.3, x2: 0.5 }
            }),
            
            // Pose 19: SQUAT CỰC SÂU + TAY GIƠ CAO + CHÂN RỘNG (Ultra deep wide squat)
            this.createPoseTemplate({
                shoulders: { y: -0.08, x: -0.15, x2: 0.15 }, // Người cực thấp
                elbows: { y: -0.6, x: -0.2, x2: 0.2 },
                wrists: { y: -0.85, x: -0.2, x2: 0.2 }, // Tay giơ cao
                hips: { y: 0.32, x: -0.22, x2: 0.22 }, // Hông cực thấp
                knees: { y: 0.49, x: -0.18, x2: 0.18 }, // Đầu gối cực thấp
                ankles: { y: 0.5, x: -0.18, x2: 0.18 }
            }),
            
            // Pose 20: TAY DANG NGANG CỰC CỰC RỘNG + CHÂN RỘNG + MỘT CHÂN CO CAO (Maximum T-pose)
            this.createPoseTemplate({
                shoulders: { y: -0.3, x: -0.45, x2: 0.45 }, // Tay dang cực cực rộng
                elbows: { y: -0.3, x: -0.55, x2: 0.55 },
                wrists: { y: -0.3, x: -0.65, x2: 0.65 },
                hips: { y: 0.1, x: -0.28, x2: 0.28 }, // Chân rộng
                knees: { y: 0.3, x: -0.33, x2: 0.42 }, // Chân phải co cao
                ankles: { y: 0.5, x: -0.33, x2: 0.57 }
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

