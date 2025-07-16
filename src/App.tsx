import React, { useRef, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import Webcam from "react-webcam";
import { FaCheckCircle, FaTimesCircle, FaQuestionCircle, FaVideoSlash, FaVideo } from 'react-icons/fa';

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
  // --- NEW: State to control camera visibility ---
  const [isCameraOn, setIsCameraOn] = useState(true);
  
  const socketRef = useRef<Socket | null>(null);
  const webcamRef = useRef<Webcam>(null);
  const temporalCheckerRef = useRef(new TemporalLivenessChecker(7, 4));

  const socketURL = "http://localhost:8000";

  useEffect(() => {
    socketRef.current = io(socketURL);
    socketRef.current.on("prediction_result", (data: { className: string; confidence: number }) => {
      setPrediction(data);
      temporalCheckerRef.current.addPrediction(data.className);
      setFinalDecision(temporalCheckerRef.current.getDecision());
    });
    socketRef.current.on("connect_error", (err) => {
      console.error("Connection Error:", err);
      setPrediction({className: "Connection Error", confidence: 0});
    });
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const captureFrame = () => {
    if (isCameraOn && webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        const base64String = imageSrc.replace("data:image/jpeg;base64,", "");
        socketRef.current?.emit("image", { image: base64String });
      }
    }
  };

  useEffect(() => {
    if (isCameraOn) {
      const interval = setInterval(() => {
        captureFrame();
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isCameraOn]); 

  const getStatusUI = () => {
    if (!isCameraOn) {
      return { color: "text-gray-500", iconName: "question" as const, text: "Kamera tidak aktif" };
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
    }
  };

  const statusUI = getStatusUI();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
      <div className="w-full max-w-2xl bg-white p-8 rounded-2xl shadow-lg text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Verifikasi Liveness</h1>
        <p className="text-gray-600 mb-6">Posisikan wajah Anda di dalam bingkai.</p>
        
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
      </div>

      <div className="w-full max-w-2xl mt-6">
        <button
          onClick={toggleCamera}
          className={`w-full flex items-center justify-center gap-3 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300 ${
            isCameraOn ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
          }`}
        >
          {isCameraOn ? <FaVideoSlash size={20} /> : <FaVideo size={20} />}
          <span>{isCameraOn ? 'Matikan Kamera' : 'Nyalakan Kamera'}</span>
        </button>
      </div>
    </div>
  );
}
