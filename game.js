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
        this.similarityThreshold = 70; // Ngưỡng similarity để pass (%)
        this.baseWallSpeed = 5000; // Thời gian tường di chuyển (ms)
        this.speedIncrease = 200; // Tăng tốc mỗi round (ms)
        
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
     * Lấy thời gian di chuyển của tường (giảm dần theo round)
     */
    getWallDuration() {
        return Math.max(
            this.baseWallSpeed - (this.round - 1) * this.speedIncrease,
            2000 // Tối thiểu 2 giây
        );
    }

    /**
     * Kiểm tra pose của người chơi
     */
    checkPose() {
        if (!this.currentTargetPose) return;

        const similarity = this.poseDetector.comparePoses(this.currentTargetPose);
        
        // Update similarity display (sẽ được gọi từ main.js)
        if (this.onSimilarityUpdate) {
            this.onSimilarityUpdate(similarity);
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
            this.score++;
            this.round++;
            this.updateUI();
            
            // Callback cho hiệu ứng
            if (this.onScoreGain) {
                this.onScoreGain(this.score);
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

