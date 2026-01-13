# 🎯 AI Hole in the Wall – Pose Challenge

Game web AI computer vision sử dụng MediaPipe Pose để nhận diện tư thế cơ thể và so sánh với pose mẫu.

## 📋 Mô tả

Người chơi đứng trước camera, AI nhận diện tư thế cơ thể. Một "bức tường" có lỗ hình dáng người di chuyển từ xa tới. Người chơi phải bắt chước tư thế để "xuyên qua tường". Nếu độ giống đạt >= 70% thì qua màn, nếu không thì mất mạng.

## 🚀 Cách chạy game

### Yêu cầu
- Trình duyệt Chrome (khuyến nghị) hoặc Edge
- Webcam
- Kết nối internet (để tải MediaPipe từ CDN)

### Các bước

1. **Tải code về máy**
   - Giải nén file hoặc clone repository

2. **Mở game**
   - Cách 1: Mở file `index.html` trực tiếp bằng Chrome
   - Cách 2: Sử dụng local server (khuyến nghị):
     ```bash
     # Với Python 3
     python -m http.server 8000
     
     # Hoặc với Node.js (nếu có http-server)
     npx http-server -p 8000
     ```
   - Truy cập: `http://localhost:8000`

3. **Cho phép truy cập camera**
   - Khi game yêu cầu, click "Cho phép" để bật webcam

4. **Chơi game!**
   - Click "Bắt Đầu Game"
   - Đợi countdown 3-2-1
   - Bắt chước tư thế hiển thị trên màn hình
   - Giữ tư thế cho đến khi tường đến

## 🎮 Luật chơi

- **Mạng**: Bắt đầu với 3 mạng
- **Điểm**: Mỗi round vượt qua = +1 điểm
- **Ngưỡng**: Cần đạt >= 70% similarity để pass
- **Tốc độ**: Tường di chuyển nhanh hơn mỗi round
- **Game Over**: Khi hết mạng

## ⚙️ Tùy chỉnh

Các thông số có thể chỉnh trong file `game.js`:

```javascript
// Số mạng
this.lives = 3;

// Ngưỡng similarity để pass (%)
this.similarityThreshold = 70;

// Thời gian tường di chuyển (ms)
this.baseWallSpeed = 5000;

// Tăng tốc mỗi round (ms)
this.speedIncrease = 200;
```

Các pose mẫu có thể chỉnh trong file `pose.js`, hàm `generateRandomPose()`.

## 📁 Cấu trúc file

```
PoseDang/
├── index.html      # Cấu trúc HTML
├── style.css       # Styling
├── main.js         # Entry point, quản lý UI
├── pose.js         # AI pose detection và so sánh
├── game.js         # Logic game (rounds, lives, scoring)
└── README.md       # Hướng dẫn
```

## 🔧 Công nghệ sử dụng

- **HTML5**: Cấu trúc
- **CSS3**: Styling với animations
- **JavaScript (ES6+)**: Logic game
- **MediaPipe Pose**: AI pose detection (chạy local)
- **Web Audio API**: Âm thanh
- **Canvas API**: Vẽ skeleton và pose

## 📝 Lưu ý

- Game chạy hoàn toàn local, không upload video lên server
- Cần kết nối internet lần đầu để tải MediaPipe
- Hoạt động tốt nhất với Chrome/Edge
- Cần đủ ánh sáng để camera nhận diện tốt
- Đứng cách camera 1-2 mét để có kết quả tốt nhất

## 🐛 Xử lý lỗi

**Lỗi: "Không thể truy cập camera"**
- Kiểm tra quyền truy cập camera trong trình duyệt
- Đảm bảo không có ứng dụng khác đang dùng camera
- Thử refresh trang

**Lỗi: "MediaPipe không load"**
- Kiểm tra kết nối internet
- Thử mở bằng local server thay vì mở file trực tiếp

**Game chạy chậm**
- Giảm độ phân giải camera trong `main.js` (width/height)
- Giảm `modelComplexity` trong `pose.js` (từ 1 xuống 0)

## 📄 License

Tự do sử dụng cho mục đích giáo dục và giải trí.

---

**Chúc bạn chơi game vui vẻ! 🎉**

