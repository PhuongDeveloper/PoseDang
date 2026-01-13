/**
 * Game Logic Module
 * Quản lý rounds, lives, scoring, và gameplay
 */

class Game {
    constructor(poseDetector) {
        this.poseDetector = poseDetector;
        
        // Game state
        this.lives = 3; // Số mạng (có thể chỉnh)
        this.score = 0;
        this.round = 1;
        this.isPlaying = false;
        this.currentTargetPose = null;
        
        // Game settings (có thể chỉnh)
        this.similarityThreshold = 80; // Ngưỡng similarity để pass (%) - CỐ ĐỊNH để dễ căn chỉnh
        this.baseWallSpeed = 6000; // Thời gian tường di chuyển ban đầu (ms)
        this.minWallSpeed = 1500; // Thời gian tối thiểu (ms)
        this.speedDecreaseRate = 0.15; // Tỷ lệ giảm thời gian mỗi round (15%)
        this.basePointsPerRound = 1; // Điểm cơ bản mỗi round
        this.pointsMultiplier = 1.2; // Hệ số nhân điểm mỗi round
        
        // Wall animation
        this.wallProgress = 0;
        this.wallAnimationId = null;
        this.wallStartTime = null;
        this.hasCheckedPose = false; // Tránh kiểm tra nhiều lần
        
        // Callbacks
        this.onScoreUpdate = null;
        this.onLivesUpdate = null;
        this.onRoundUpdate = null;
        this.onProgressUpdate = null;
        this.onSimilarityUpdate = null;
        this.onTimeRemainingUpdate = null;
        this.onThresholdUpdate = null;
        this.onGameOver = null;
        this.onRoundComplete = null;
        this.onScoreGain = null;
        this.onLifeLost = null;
        
        // Pose canvas
        this.poseCanvas = null;
        this.poseCtx = null;
    }

    /**
     * Khởi tạo game
     */
    initialize(poseCanvas) {
        this.poseCanvas = poseCanvas;
        this.poseCtx = poseCanvas.getContext('2d');
        
        // Set canvas size
        this.poseCanvas.width = poseCanvas.offsetWidth;
        this.poseCanvas.height = poseCanvas.offsetHeight;
    }

    /**
     * Bắt đầu game mới
     */
    startNewGame() {
        this.lives = 3;
        this.score = 0;
        this.round = 1;
        this.isPlaying = true;
        this.updateUI();
        this.startRound();
    }

    /**
     * Bắt đầu một round mới
     */
    startRound() {
        // Tạo pose mẫu ngẫu nhiên
        this.currentTargetPose = this.poseDetector.generateRandomPose();
        
        // Vẽ pose silhouette
        this.drawTargetPose();
        
        // Reset wall progress
        this.wallProgress = 0;
        this.wallStartTime = Date.now();
        this.hasCheckedPose = false;
        
        // Update threshold display
        if (this.onThresholdUpdate) {
            this.onThresholdUpdate(this.similarityThreshold);
        }
        
        // Bắt đầu animation tường
        this.animateWall();
    }

    /**
     * Vẽ pose mục tiêu lên canvas
     */
    drawTargetPose() {
        if (this.currentTargetPose && this.poseCanvas && this.poseCtx) {
            this.poseDetector.drawPoseSilhouette(
                this.currentTargetPose,
                this.poseCanvas,
                this.poseCtx
            );
        }
    }

    /**
     * Animation tường di chuyển
     */
    animateWall() {
        if (!this.isPlaying) return;

        const currentTime = Date.now();
        const elapsed = currentTime - this.wallStartTime;
        const wallDuration = this.getWallDuration();
        
        this.wallProgress = Math.min(elapsed / wallDuration, 1);
        
        // Update progress bar
        if (this.onProgressUpdate) {
            this.onProgressUpdate(1 - this.wallProgress);
        }

        // Update time remaining
        if (this.onTimeRemainingUpdate) {
            const remaining = Math.max(0, this.getWallDuration() - elapsed);
            this.onTimeRemainingUpdate(Math.ceil(remaining / 1000));
        }

        // Khi tường đến (100%)
        if (this.wallProgress >= 1) {
            if (!this.hasCheckedPose) {
                this.hasCheckedPose = true;
                this.endRound();
            }
        } else {
            this.wallAnimationId = requestAnimationFrame(() => this.animateWall());
        }
    }

    /**
     * Lấy thời gian di chuyển của tường (giảm mạnh theo round)
     */
    getWallDuration() {
        if (this.round === 1) {
            return this.baseWallSpeed; // Round 1: 6 giây
        }
        
        // Giảm theo hàm mũ: mỗi round giảm 15%
        const duration = this.baseWallSpeed * Math.pow(1 - this.speedDecreaseRate, this.round - 1);
        return Math.max(duration, this.minWallSpeed);
    }
    
    /**
     * Tính điểm nhận được khi pass round này
     */
    getPointsForRound() {
        // Điểm tăng theo hàm mũ: round 1 = 1 điểm, round 5 = ~2 điểm, round 10 = ~6 điểm
        const points = Math.floor(this.basePointsPerRound * Math.pow(this.pointsMultiplier, this.round - 1));
        return Math.max(1, points); // Tối thiểu 1 điểm
    }

    /**
     * Kiểm tra pose của người chơi
     */
    checkPose() {
        if (!this.currentTargetPose) return;

        const similarity = this.poseDetector.comparePoses(this.currentTargetPose);
        
        // Update similarity display với threshold (sẽ được gọi từ main.js)
        if (this.onSimilarityUpdate) {
            this.onSimilarityUpdate(similarity, this.similarityThreshold);
        }

        return similarity;
    }

    /**
     * Kết thúc round và kiểm tra kết quả
     */
    endRound() {
        if (this.wallAnimationId) {
            cancelAnimationFrame(this.wallAnimationId);
            this.wallAnimationId = null;
        }

        const similarity = this.checkPose();
        
        if (similarity >= this.similarityThreshold) {
            // PASS
            const pointsGained = this.getPointsForRound();
            this.score += pointsGained;
            this.round++;
            this.updateUI();
            
            // Callback cho hiệu ứng với điểm nhận được
            if (this.onScoreGain) {
                this.onScoreGain(this.score, pointsGained);
            }
            if (this.onRoundComplete) {
                this.onRoundComplete(true, similarity);
            }
            
            // Chờ một chút rồi bắt đầu round mới
            setTimeout(() => {
                if (this.isPlaying) {
                    this.startRound();
                }
            }, 2000);
        } else {
            // FAIL
            this.lives--;
            this.updateUI();
            
            // Callback cho hiệu ứng
            if (this.onLifeLost) {
                this.onLifeLost(this.lives);
            }
            if (this.onRoundComplete) {
                this.onRoundComplete(false, similarity);
            }
            
            // Kiểm tra game over
            if (this.lives <= 0) {
                this.gameOver();
            } else {
                // Chờ một chút rồi bắt đầu round mới
                setTimeout(() => {
                    if (this.isPlaying) {
                        this.startRound();
                    }
                }, 2500);
            }
        }
    }

    /**
     * Game Over
     */
    gameOver() {
        this.isPlaying = false;
        
        if (this.wallAnimationId) {
            cancelAnimationFrame(this.wallAnimationId);
            this.wallAnimationId = null;
        }
        
        if (this.onGameOver) {
            this.onGameOver(this.score);
        }
    }

    /**
     * Cập nhật UI
     */
    updateUI() {
        if (this.onScoreUpdate) {
            this.onScoreUpdate(this.score);
        }
        if (this.onLivesUpdate) {
            this.onLivesUpdate(this.lives);
        }
        if (this.onRoundUpdate) {
            this.onRoundUpdate(this.round);
        }
    }

    /**
     * Dừng game
     */
    stop() {
        this.isPlaying = false;
        if (this.wallAnimationId) {
            cancelAnimationFrame(this.wallAnimationId);
            this.wallAnimationId = null;
        }
    }

    /**
     * Reset game
     */
    reset() {
        this.stop();
        this.lives = 3;
        this.score = 0;
        this.round = 1;
        this.wallProgress = 0;
        this.currentTargetPose = null;
        this.hasCheckedPose = false;
        this.updateUI();
    }
}

