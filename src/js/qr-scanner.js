// src/js/qr-scanner.js - SIMPLE RELIABLE QR SCANNER
class SimpleQRScanner {
    constructor(options = {}) {
        this.options = {
            debug: true,
            scanInterval: 100, // ms between scans
            maxScanTime: 30000, // 30 seconds max
            ...options
        };
        
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasContext = null;
        this.isScanning = false;
        this.scanInterval = null;
        this.onScanCallback = null;
        this.onErrorCallback = null;
        this.stream = null;
        
        this.debugLog('QR Scanner initialized', this.options);
    }
    
    debugLog(message, data = null) {
        if (this.options.debug) {
            console.log(`📱 [QR Scanner] ${message}`);
            if (data) console.log('📊', data);
        }
    }
    
    // Initialize scanner
    async init(containerId) {
        try {
            this.debugLog('Initializing scanner in container:', containerId);
            
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Container #${containerId} not found`);
            }
            
            // Create video element
            this.videoElement = document.createElement('video');
            this.videoElement.id = 'qrScannerVideo';
            this.videoElement.autoplay = true;
            this.videoElement.playsInline = true;
            this.videoElement.style.width = '100%';
            this.videoElement.style.maxWidth = '400px';
            this.videoElement.style.borderRadius = '8px';
            this.videoElement.style.transform = 'scaleX(-1)'; // Mirror for front camera
            
            // Create canvas for QR detection
            this.canvasElement = document.createElement('canvas');
            this.canvasElement.id = 'qrScannerCanvas';
            this.canvasElement.style.display = 'none';
            
            // Create status display
            const statusDiv = document.createElement('div');
            statusDiv.id = 'qrScannerStatus';
            statusDiv.innerHTML = `
                <div style="text-align: center; padding: 10px;">
                    <p style="color: #666; margin-bottom: 10px;">Point camera at QR code</p>
                    <div id="qrScannerFeedback" style="
                        padding: 10px;
                        border-radius: 4px;
                        background: #f8f9fa;
                        margin-bottom: 10px;
                        font-family: monospace;
                        font-size: 12px;
                        min-height: 40px;
                    "></div>
                </div>
            `;
            
            // Clear container and add elements
            container.innerHTML = '';
            container.appendChild(this.videoElement);
            container.appendChild(this.canvasElement);
            container.appendChild(statusDiv);
            
            this.canvasContext = this.canvasElement.getContext('2d');
            
            this.debugLog('Scanner elements created');
            return true;
            
        } catch (error) {
            this.debugLog('Initialization error', error);
            throw error;
        }
    }
    
    // Start scanning
    async startScanning(onScan, onError) {
        try {
            this.onScanCallback = onScan;
            this.onErrorCallback = onError;
            
            this.debugLog('Requesting camera access...');
            
            // Request camera access
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Prefer rear camera
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.videoElement.srcObject = this.stream;
            
            // Wait for video to be ready
            await new Promise((resolve) => {
                this.videoElement.onloadedmetadata = () => {
                    this.videoElement.play();
                    resolve();
                };
            });
            
            // Set canvas size to match video
            this.canvasElement.width = this.videoElement.videoWidth;
            this.canvasElement.height = this.videoElement.videoHeight;
            
            this.isScanning = true;
            this.debugLog('Camera started, starting scan loop...', {
                width: this.videoElement.videoWidth,
                height: this.videoElement.videoHeight
            });
            
            // Start scan loop
            this.scanInterval = setInterval(() => {
                this.scanFrame();
            }, this.options.scanInterval);
            
            // Auto-stop after max time
            setTimeout(() => {
                if (this.isScanning) {
                    this.debugLog('Max scan time reached, stopping');
                    this.stopScanning();
                    if (this.onErrorCallback) {
                        this.onErrorCallback('Scan timeout after 30 seconds');
                    }
                }
            }, this.options.maxScanTime);
            
            this.updateFeedback('Camera started. Looking for QR codes...');
            
        } catch (error) {
            this.debugLog('Camera error', error);
            if (this.onErrorCallback) {
                this.onErrorCallback(`Camera error: ${error.message}`);
            }
            this.stopScanning();
        }
    }
    
    // Scan a single frame
    scanFrame() {
        if (!this.isScanning || !this.videoElement.readyState >= 2) {
            return;
        }
        
        try {
            // Draw video frame to canvas
            this.canvasContext.drawImage(
                this.videoElement,
                0, 0,
                this.canvasElement.width,
                this.canvasElement.height
            );
            
            // Get image data from canvas
            const imageData = this.canvasContext.getImageData(
                0, 0,
                this.canvasElement.width,
                this.canvasElement.height
            );
            
            // Try to detect QR code
            const qrCode = this.detectQRCode(imageData);
            
            if (qrCode) {
                this.debugLog('QR Code detected!', { data: qrCode });
                this.updateFeedback(`✅ QR Code found: ${qrCode.substring(0, 30)}...`);
                
                if (this.onScanCallback) {
                    this.onScanCallback(qrCode);
                }
                
                // Optional: Stop after successful scan
                // this.stopScanning();
            } else {
                this.updateFeedback('🔍 Scanning...');
            }
            
        } catch (error) {
            this.debugLog('Scan frame error', error);
        }
    }
    
    // Simple QR code detection (placeholder - you can integrate a proper library)
    detectQRCode(imageData) {
        // This is a simple placeholder. In production, use a library like:
        // - jsQR: https://github.com/cozmo/jsQR
        // - qrcode-reader: https://github.com/edi9999/jsqrcode
        
        // For now, let's implement a basic check for debugging
        // In production, you should integrate a proper QR library
        
        // Return null for this placeholder
        // In your actual implementation, you would:
        // 1. Use jsQR library to detect QR codes
        // 2. Return the decoded data
        
        this.debugLog('QR detection called (placeholder)', {
            imageSize: `${imageData.width}x${imageData.height}`,
            dataLength: imageData.data.length
        });
        
        return null; // Replace with actual QR detection
    }
    
    // Update feedback display
    updateFeedback(message) {
        const feedbackEl = document.getElementById('qrScannerFeedback');
        if (feedbackEl) {
            feedbackEl.textContent = message;
            feedbackEl.style.background = message.includes('✅') ? '#d4edda' : 
                                         message.includes('❌') ? '#f8d7da' : '#f8f9fa';
        }
    }
    
    // Stop scanning
    stopScanning() {
        this.debugLog('Stopping scanner...');
        this.isScanning = false;
        
        // Clear interval
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        
        // Stop video stream
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        // Clear video source
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
        
        this.updateFeedback('Scanner stopped');
        this.debugLog('Scanner stopped');
    }
    
    // Clean up
    destroy() {
        this.stopScanning();
        if (this.videoElement && this.videoElement.parentNode) {
            this.videoElement.parentNode.removeChild(this.videoElement);
        }
        if (this.canvasElement && this.canvasElement.parentNode) {
            this.canvasElement.parentNode.removeChild(this.canvasElement);
        }
        this.debugLog('Scanner destroyed');
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleQRScanner;
}