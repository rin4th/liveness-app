import React, { useRef, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import Webcam from "react-webcam";
import { FaCheckCircle, FaTimesCircle, FaQuestionCircle, FaVideoSlash, FaVideo, FaPlay } from 'react-icons/fa';

class TemporalLivenessChecker {
    predictionHistory: string[];
    windowSize: number;
    realThreshold: number;

    constructor(windowSize = 7, realThreshold = 4) {
        this.predictionHistory = [];
        this.windowSize = windowSize;
        this.realThreshold = realThreshold;
    }

    addPrediction(prediction: string) {
        this.predictionHistory.push(prediction);
        if (this.predictionHistory.length > this.windowSize) {
            this.predictionHistory.shift();
        }
    }

    getDecision(): string {
        if (this.predictionHistory.length < this.windowSize) {
            return "UNCERTAIN";
        }
        const realCount = this.predictionHistory.filter((p) => p === 'real').length;
        const spoofCount = this.predictionHistory.length - realCount;

        if (realCount >= this.realThreshold) {
            return "LIVENESS_CONFIRMED";
        }
        if (spoofCount >= this.realThreshold) {
            return "SPOOF_DETECTED";
        }
        return "UNCERTAIN";
    }
}

type StatusIconProps = {
  name: 'check' | 'times' | 'question';
  color: string;
};

const StatusIcon: React.FC<StatusIconProps> = ({ name, color }) => {
  switch (name) {
    case 'check':
      return <FaCheckCircle size={32} className={color} />;
    case 'times':
      return <FaTimesCircle size={32} className={color} />;
    case 'question':
      return <FaQuestionCircle size={32} className={color} />;
    default:
      return null;
  }
};

export default function App() {
  const [prediction, setPrediction] = useState<{ className: string; confidence: number } | null>(null);
  const [finalDecision, setFinalDecision] = useState<string>("UNCERTAIN");
  const [isCameraOn, setIsCameraOn] = useState(true);
  
  // New states for 15-second accuracy collection
  const [isCollecting, setIsCollecting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(15);
  const [accuracyData, setAccuracyData] = useState<{className: string; confidence: number}[]>([]);
  const [finalAccuracy, setFinalAccuracy] = useState<{
    averageConfidence: number; 
    totalPredictions: number; 
    benignCount: number; 
    printAttackCount: number; 
    replayAttackCount: number;
    conclusion: 'Liveness' | 'Spoofing Attack';
  } | null>(null);
  const [showResults, setShowResults] = useState(false);
  
  const socketRef = useRef<Socket | null>(null);
  const webcamRef = useRef<Webcam>(null);
  const temporalCheckerRef = useRef(new TemporalLivenessChecker(7, 4));
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const socketURL = "http://localhost:8000";

  useEffect(() => {
    socketRef.current = io(socketURL);
    
    // This runs for ALL predictions (like your original code)
    socketRef.current.on("prediction_result", (data: { className: string; confidence: number }) => {
      console.log('Received prediction:', data);
      setPrediction(data);
      temporalCheckerRef.current.addPrediction(data.className);
      setFinalDecision(temporalCheckerRef.current.getDecision());
      
      // Only collect data during the 15-second collection period
      if (isCollecting) {
        setAccuracyData(prev => {
          const newData = [...prev, data];
          console.log('Collected data:', newData);
          return newData;
        });
      }
    });
    
    socketRef.current.on("connect_error", (err) => {
      console.error("Connection Error:", err);
      setPrediction({className: "Connection Error", confidence: 0});
    });
    
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isCollecting]); // Add isCollecting as dependency

  const captureFrame = () => {
    if (isCameraOn && webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        const base64String = imageSrc.replace("data:image/jpeg;base64,", "");
        socketRef.current?.emit("image", { image: base64String });
      }
    }
  };

  // This runs continuously when camera is on (like your original code)
  useEffect(() => {
    if (isCameraOn) {
      const interval = setInterval(() => {
        captureFrame();
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isCameraOn]); 

  const startCollection = () => {
    console.log('Starting 15-second collection...');
    // Reset collection states
    setAccuracyData([]);
    setFinalAccuracy(null);
    setShowResults(false);
    setTimeRemaining(15);
    setIsCollecting(true);

    // Start countdown timer
    let timeLeft = 15;
    const countdownInterval = setInterval(() => {
      timeLeft -= 1;
      setTimeRemaining(timeLeft);
      console.log('Time remaining:', timeLeft);
      
      if (timeLeft <= 0) {
        console.log('Collection finished, calculating results...');
        clearInterval(countdownInterval);
        stopCollection();
      }
    }, 1000);
    
    timerRef.current = countdownInterval;
  };

  const stopCollection = () => {
    console.log('Stopping collection...');
    setIsCollecting(false);
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    console.log('Final accuracy data:', accuracyData);

    // Calculate final accuracy with specific attack types
    if (accuracyData.length > 0) {
      const totalPredictions = accuracyData.length;
      const benignCount = accuracyData.filter(data => 
        data.className.toLowerCase() === 'real' || 
        data.className.toLowerCase() === 'benign' || 
        data.className.toLowerCase() === 'live'
      ).length;
      const printAttackCount = accuracyData.filter(data => 
        data.className.toLowerCase().includes('print') || 
        data.className.toLowerCase() === 'print_attack'
      ).length;
      const replayAttackCount = accuracyData.filter(data => 
        data.className.toLowerCase().includes('replay') || 
        data.className.toLowerCase() === 'replay_attack'
      ).length;
      
      const spoofingCount = printAttackCount + replayAttackCount;
      const averageConfidence = accuracyData.reduce((sum, data) => sum + data.confidence, 0) / totalPredictions;
      
      // Conclusion: if benign count is more than total spoofing attacks
      const conclusion = benignCount > spoofingCount ? 'Liveness' : 'Spoofing Attack';
      
      const results = {
        averageConfidence,
        totalPredictions,
        benignCount,
        printAttackCount,
        replayAttackCount,
        conclusion
      };
      
      console.log('Final results:', results);
      setFinalAccuracy(results);
    } else {
      console.log('No data collected');
      setFinalAccuracy({
        averageConfidence: 0,
        totalPredictions: 0,
        benignCount: 0,
        printAttackCount: 0,
        replayAttackCount: 0,
        conclusion: 'Spoofing Attack'
      });
    }
    
    setShowResults(true);
  };

  const getStatusUI = () => {
    if (!isCameraOn) {
      return { color: "text-gray-500", iconName: "question" as const, text: "Kamera tidak aktif" };
    }
    
    if (showResults && finalAccuracy) {
      if (finalAccuracy.conclusion === 'Liveness') {
        return { color: "text-green-500", iconName: "check" as const, text: "Liveness Terkonfirmasi" };
      } else {
        return { color: "text-red-500", iconName: "times" as const, text: "Serangan Spoof Terdeteksi" };
      }
    }
    
    switch (finalDecision) {
      case "LIVENESS_CONFIRMED":
        return { color: "text-green-500", iconName: "check" as const, text: "Liveness Terkonfirmasi" };
      case "SPOOF_DETECTED":
        return { color: "text-red-500", iconName: "times" as const, text: "Serangan Spoof Terdeteksi" };
      default:
        return { color: "text-yellow-500", iconName: "question" as const, text: "Menganalisis..." };
    }
  };

  const toggleCamera = () => {
    setIsCameraOn(prevState => !prevState);
    if (isCameraOn) {
        setPrediction(null);
        setFinalDecision("UNCERTAIN");
        // Stop collection if running
        if (isCollecting) {
          stopCollection();
        }
    }
  };

  const statusUI = getStatusUI();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
      <div className="w-full max-w-2xl bg-white p-8 rounded-2xl shadow-lg text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Verifikasi Liveness</h1>
        <p className="text-gray-600 mb-6">Posisikan wajah Anda di dalam bingkai.</p>
        
        {/* Timer Display - Only show during collection */}
        {isCollecting && (
          <div className="mb-4 p-3 bg-blue-100 rounded-lg">
            <p className="text-lg font-semibold text-blue-800">
              Mengumpulkan data: {timeRemaining} detik
            </p>
            <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                style={{ width: `${((15 - timeRemaining) / 15) * 100}%` }}
              ></div>
            </div>
          </div>
        )}
        
        <div className={`relative w-full aspect-video rounded-lg overflow-hidden border-4 flex items-center justify-center bg-black ${
          finalDecision === "LIVENESS_CONFIRMED" && isCameraOn ? "border-green-500" :
          finalDecision === "SPOOF_DETECTED" && isCameraOn ? "border-red-500" : 
          isCameraOn ? "border-yellow-500" : "border-gray-300"
        } transition-all duration-300`}>
          {isCameraOn ? (
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              className="w-full h-full object-cover"
              mirrored={true}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-gray-400">
                <FaVideoSlash size={64} />
                <p className="mt-4 text-xl font-semibold">Kamera Tidak Aktif</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col items-center justify-center w-full h-24">
          <div className="flex items-center gap-4">
            <StatusIcon name={statusUI.iconName} color={statusUI.color} />
            <p className={`text-2xl font-bold ${statusUI.color}`}>{statusUI.text}</p>
          </div>
          {prediction && isCameraOn && (
            <p className="text-lg mt-2 text-gray-500">
              Frame Saat Ini: <span className="font-semibold">{prediction.className}</span> ({Math.round(prediction.confidence * 100)}%)
            </p>
          )}
        </div>

        {/* Results Display */}
        {showResults && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border-2 border-blue-200">
            <h3 className="text-xl font-bold text-gray-800 mb-3">Hasil Deteksi (15 detik)</h3>
            
            {finalAccuracy ? (
              <>
                {/* Detection Counts */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-white p-3 rounded">
                    <p className="font-semibold text-gray-700">Total Prediksi</p>
                    <p className="text-2xl font-bold text-blue-600">{finalAccuracy.totalPredictions}</p>
                  </div>
                  <div className="bg-white p-3 rounded">
                    <p className="font-semibold text-gray-700">Rata-rata Confidence</p>
                    <p className="text-2xl font-bold text-purple-600">{(finalAccuracy.averageConfidence * 100).toFixed(1)}%</p>
                  </div>
                </div>

                {/* Attack Type Breakdown */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-green-50 border border-green-200 p-3 rounded">
                    <p className="font-semibold text-green-800">Benign</p>
                    <p className="text-xl font-bold text-green-600">{finalAccuracy.benignCount}</p>
                    <p className="text-sm text-green-600">
                      {finalAccuracy.totalPredictions > 0 ? ((finalAccuracy.benignCount / finalAccuracy.totalPredictions) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                  <div className="bg-red-50 border border-red-200 p-3 rounded">
                    <p className="font-semibold text-red-800">Print Attack</p>
                    <p className="text-xl font-bold text-red-600">{finalAccuracy.printAttackCount}</p>
                    <p className="text-sm text-red-600">
                      {finalAccuracy.totalPredictions > 0 ? ((finalAccuracy.printAttackCount / finalAccuracy.totalPredictions) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 p-3 rounded">
                    <p className="font-semibold text-orange-800">Replay Attack</p>
                    <p className="text-xl font-bold text-orange-600">{finalAccuracy.replayAttackCount}</p>
                    <p className="text-sm text-orange-600">
                      {finalAccuracy.totalPredictions > 0 ? ((finalAccuracy.replayAttackCount / finalAccuracy.totalPredictions) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>

                {/* Final Conclusion */}
                <div className={`p-4 rounded-lg border-2 ${
                  finalAccuracy.conclusion === 'Liveness' 
                    ? 'bg-green-50 border-green-300' 
                    : 'bg-red-50 border-red-300'
                }`}>
                  <p className="font-semibold text-gray-700 mb-2">Kesimpulan:</p>
                  <p className={`text-2xl font-bold ${
                    finalAccuracy.conclusion === 'Liveness' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {finalAccuracy.conclusion === 'Liveness' ? '✅ LIVENESS CONFIRMED' : '❌ SPOOFING ATTACK DETECTED'}
                  </p>
                  <p className="text-sm text-gray-600 mt-2">
                    {finalAccuracy.totalPredictions === 0 ? 
                      'Tidak ada data yang dikumpulkan selama periode deteksi.' :
                      finalAccuracy.conclusion === 'Liveness' 
                        ? `Deteksi benign (${finalAccuracy.benignCount}) lebih banyak dari serangan spoofing (${finalAccuracy.printAttackCount + finalAccuracy.replayAttackCount})`
                        : `Serangan spoofing (${finalAccuracy.printAttackCount + finalAccuracy.replayAttackCount}) lebih banyak dari deteksi benign (${finalAccuracy.benignCount})`
                    }
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-gray-500">Memproses hasil...</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full max-w-2xl mt-6 space-y-3">
        {/* Camera Toggle Button */}
        <button
          onClick={toggleCamera}
          className={`w-full flex items-center justify-center gap-3 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300 ${
            isCameraOn ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {isCameraOn ? <FaVideoSlash size={20} /> : <FaVideo size={20} />}
          <span>{isCameraOn ? 'Matikan Kamera' : 'Nyalakan Kamera'}</span>
        </button>

        {/* Start Collection Button */}
        {isCameraOn && !isCollecting && (
          <button
            onClick={startCollection}
            className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300"
          >
            <FaPlay size={20} />
            <span>{showResults ? 'Mulai Lagi' : 'Mulai Pengumpulan Data (15 detik)'}</span>
          </button>
        )}
      </div>
    </div>
  );
}