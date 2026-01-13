/**
 * Main Game Controller
 * Quản lý luồng game, UI, và kết nối các module
 */

// Global instances
let poseDetector;
let game;
let currentScreen = 'start';

// DOM Elements
const startScreen = document.getElementById('startScreen');
const countdownScreen = document.getElementById('countdownScreen');
const gameScreen = document.getElementById('gameScreen');
const gameOverScreen = document.getElementById('gameOverScreen');

const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');

const video = document.getElementById('video');
const previewVideo = document.getElementById('previewVideo');
const outputCanvas = document.getElementById('outputCanvas');
const poseCanvas = document.getElementById('poseCanvas');
const progressBar = document.getElementById('progressBar');
const similarityText = document.getElementById('similarityText');
const similarityDisplay = document.getElementById('similarityDisplay');
const countdownNumber = document.getElementById('countdownNumber');
const cameraStatus = document.getElementById('cameraStatus');

const scoreElement = document.getElementById('score');
const roundElement = document.getElementById('round');
const livesElement = document.getElementById('lives');
const finalScoreElement = document.getElementById('finalScore');

/**
 * Khởi tạo ứng dụng
 */
async function init() {
    // Setup event listeners
    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', restartGame);

    // Khởi tạo PoseDetector
    poseDetector = new PoseDetector();
    
    // Setup canvas size
    setupCanvas();
    
    // Resize canvas khi window resize
    window.addEventListener('resize', setupCanvas);
    
    // Bật camera preview ngay khi vào trang
    await startCameraPreview();
}

/**
 * Setup canvas size
 */
function setupCanvas() {
    // Setup game canvas
    if (video && video.parentElement) {
        const videoWrapper = video.parentElement;
        const width = videoWrapper.offsetWidth;
        const height = videoWrapper.offsetHeight;
        
        if (outputCanvas) {
            outputCanvas.width = width;
            outputCanvas.height = height;
        }
    }
    
    if (poseCanvas) {
        const wallElement = poseCanvas.parentElement;
        if (wallElement) {
            poseCanvas.width = wallElement.offsetWidth;
            poseCanvas.height = wallElement.offsetHeight;
        }
    }
}

/**
 * Bắt đầu camera preview trên màn hình Start
 */
async function startCameraPreview() {
    try {
        // Lấy stream từ camera
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            }
        });
        
        // Hiển thị video preview
        if (previewVideo) {
            previewVideo.srcObject = stream;
        }
        
        // Cập nhật status
        if (cameraStatus) {
            cameraStatus.innerHTML = '<span class="status-icon">✅</span><span class="status-text">Camera sẵn sàng!</span>';
            cameraStatus.classList.add('ready');
        }
        
        // Lưu stream để dùng lại khi start game
        window.previewStream = stream;
        
    } catch (error) {
        console.error('Lỗi khi bật camera preview:', error);
        if (cameraStatus) {
            cameraStatus.innerHTML = '<span class="status-icon">❌</span><span class="status-text">Không thể truy cập camera</span>';
            cameraStatus.classList.add('error');
        }
    }
}

/**
 * Bắt đầu game
 */
async function startGame() {
    try {
        // Chuyển sang màn hình countdown
        showScreen('countdown');
        
        // Khởi tạo PoseDetector với video chính
        await poseDetector.initialize(video, outputCanvas);
        
        // Sử dụng stream từ preview hoặc lấy mới
        let stream;
        if (window.previewStream) {
            stream = window.previewStream;
            video.srcObject = stream;
            if (previewVideo) {
                previewVideo.pause();
                previewVideo.srcObject = null; // giải phóng phần hiển thị nhưng không stop track
            }
        } else {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: 'user'
                }
            });
            video.srcObject = stream;
        }
        
        // Đợi video load
        await new Promise((resolve) => {
            if (video.readyState >= 2) {
                resolve();
            } else {
                video.onloadedmetadata = resolve;
            }
        });
        
        // Countdown
        await countdown(3);
        
        // Bắt đầu camera với MediaPipe
        await poseDetector.startCamera();
        
        // Khởi tạo Game
        game = new Game(poseDetector);
        game.initialize(poseCanvas);
        
        // Setup callbacks
        setupGameCallbacks();
        
        // Chuyển sang màn hình game
        showScreen('game');
        
        // Bắt đầu game
        game.startNewGame();
        
    } catch (error) {
        console.error('Lỗi khi bắt đầu game:', error);
        alert('Không thể truy cập camera. Vui lòng kiểm tra quyền truy cập.');
        showScreen('start');
        // Thử lại preview
        await startCameraPreview();
    }
}

/**
 * Countdown
 */
function countdown(seconds) {
    return new Promise((resolve) => {
        let current = seconds;
        countdownNumber.textContent = current;
        
        const interval = setInterval(() => {
            current--;
            if (current > 0) {
                countdownNumber.textContent = current;
            } else {
                countdownNumber.textContent = 'GO!';
                clearInterval(interval);
                setTimeout(resolve, 500);
            }
        }, 1000);
    });
}

/**
 * Setup game callbacks
 */
function setupGameCallbacks() {
    // Score update
    game.onScoreUpdate = (score) => {
        scoreElement.textContent = score;
    };
    
    // Lives update
    game.onLivesUpdate = (lives) => {
        const hearts = livesElement.querySelectorAll('.heart');
        hearts.forEach((heart, index) => {
            if (index < lives) {
                heart.classList.remove('lost');
            } else {
                heart.classList.add('lost');
            }
        });
    };
    
    // Round update
    game.onRoundUpdate = (round) => {
        roundElement.textContent = round;
    };
    
    // Progress update
    game.onProgressUpdate = (progress) => {
        progressBar.style.width = `${progress * 100}%`;
    };
    
    // Similarity update (real-time)
    game.onSimilarityUpdate = (similarity) => {
        if (similarityText && similarityDisplay) {
            similarityText.textContent = `${similarity}%`;
            
            // Đổi màu theo similarity
            similarityDisplay.classList.remove('pass', 'fail');
            if (similarity >= game.similarityThreshold) {
                similarityDisplay.classList.add('pass');
            } else {
                similarityDisplay.classList.add('fail');
            }
        }
    };
    
    // Round complete
    game.onRoundComplete = (passed, similarity) => {
        if (passed) {
            playPassSound();
            createConfetti();
        } else {
            playFailSound();
            shakeScreen();
        }
    };
    
    // Game over
    game.onGameOver = (finalScore) => {
        finalScoreElement.textContent = finalScore;
        poseDetector.stopCamera();
        
        // Reset similarity display
        if (similarityText) {
            similarityText.textContent = '0%';
        }
        if (similarityDisplay) {
            similarityDisplay.classList.remove('pass', 'fail');
        }
        if (progressBar) {
            progressBar.style.width = '100%';
        }
        
        showScreen('gameOver');
    };
    
    // Real-time similarity check (mỗi frame)
    setInterval(() => {
        if (game && game.isPlaying && game.currentTargetPose) {
            const similarity = game.checkPose();
            if (game.onSimilarityUpdate) {
                game.onSimilarityUpdate(similarity);
            }
        }
    }, 100); // Update mỗi 100ms
}

/**
 * Restart game
 */
async function restartGame() {
    if (game) {
        game.reset();
    }
    if (poseDetector) {
        poseDetector.stopCamera();
    }
    
    // Bật lại camera preview
    await startCameraPreview();
    
    showScreen('start');
}

/**
 * Chuyển màn hình
 */
function showScreen(screenName) {
    // Ẩn tất cả màn hình
    startScreen.classList.remove('active');
    countdownScreen.classList.remove('active');
    gameScreen.classList.remove('active');
    gameOverScreen.classList.remove('active');
    
    // Hiển thị màn hình được chọn
    switch (screenName) {
        case 'start':
            startScreen.classList.add('active');
            break;
        case 'countdown':
            countdownScreen.classList.add('active');
            break;
        case 'game':
            gameScreen.classList.add('active');
            setupCanvas(); // Resize canvas khi vào game
            break;
        case 'gameOver':
            gameOverScreen.classList.add('active');
            break;
    }
    
    currentScreen = screenName;
}

/**
 * Tạo confetti effect
 */
function createConfetti() {
    const container = document.getElementById('confettiContainer');
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = '-10px';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        
        container.appendChild(confetti);
        
        setTimeout(() => {
            confetti.remove();
        }, 5000);
    }
}

/**
 * Shake screen effect
 */
function shakeScreen() {
    gameScreen.classList.add('shake');
    setTimeout(() => {
        gameScreen.classList.remove('shake');
    }, 500);
}

/**
 * Play pass sound (sử dụng Web Audio API)
 */
function playPassSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
        console.log('Không thể phát âm thanh:', error);
    }
}

/**
 * Play fail sound
 */
function playFailSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 200;
        oscillator.type = 'sawtooth';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        console.log('Không thể phát âm thanh:', error);
    }
}

// Khởi tạo khi DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

