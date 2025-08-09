import React, { useRef, useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import Webcam from "react-webcam";
import { FaCheckCircle, FaTimesCircle, FaQuestionCircle, FaVideoSlash, FaVideo, FaPlay } from 'react-icons/fa';

// Kelas untuk menghaluskan fluktuasi prediksi dari server
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

// Komponen untuk menampilkan ikon status
const StatusIcon: React.FC<{ name: 'check' | 'times' | 'question'; color: string; }> = ({ name, color }) => {
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

// Fungsi untuk membuat prediksi dummy (untuk pengujian UI tanpa server)
const generateDummyPrediction = (): { className: string; confidence: number } => {
    const classNames = ['real', 'print', 'replay'];
    const randomClass = classNames[Math.floor(Math.random() * classNames.length)];
    const randomConfidence = Math.random() * (0.99 - 0.85) + 0.85; // Akurasi antara 85% dan 99%
    return {
        className: randomClass,
        confidence: randomConfidence,
    };
};

// Komponen utama aplikasi
export default function App() {
    // State untuk mengelola status aplikasi
    const [prediction, setPrediction] = useState<{ className: string; confidence: number } | null>(null);
    const [finalDecision, setFinalDecision] = useState<string>("UNCERTAIN");
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [isCollecting, setIsCollecting] = useState(false);
    const [accuracyData, setAccuracyData] = useState<{ className: string; confidence: number }[]>([]);
    const [finalAccuracy, setFinalAccuracy] = useState<any>(null);
    const [showResults, setShowResults] = useState(false);
    const [countdown, setCountdown] = useState(10);

    // Refs untuk menyimpan referensi yang persisten
    const socketRef = useRef<Socket | null>(null);
    const webcamRef = useRef<Webcam>(null);
    const temporalCheckerRef = useRef(new TemporalLivenessChecker(7, 4));
    const collectionTimerRef = useRef<NodeJS.Timeout | null>(null);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
    
    // Refs untuk mengatasi "stale state" di dalam callback dan timer
    const isCollectingRef = useRef(isCollecting);
    useEffect(() => {
        isCollectingRef.current = isCollecting;
    }, [isCollecting]);
    
    const accuracyDataRef = useRef(accuracyData);
    useEffect(() => {
        accuracyDataRef.current = accuracyData;
    }, [accuracyData]);

    const socketURL = "http://localhost:8000";

    // Fungsi untuk menghitung hasil akhir setelah koleksi selesai
    const calculateAndShowResults = useCallback((dataToProcess: { className: string; confidence: number }[]) => {
        if (dataToProcess.length > 0) {
            const totalPredictions = dataToProcess.length;
            const benignCount = dataToProcess.filter(data => ['real', 'benign', 'live'].includes(data.className.toLowerCase())).length;
            const printAttackCount = dataToProcess.filter(data => data.className.toLowerCase().includes('print')).length;
            const replayAttackCount = dataToProcess.filter(data => data.className.toLowerCase().includes('replay')).length;
            const spoofingCount = printAttackCount + replayAttackCount;
            const averageConfidence = dataToProcess.reduce((sum, data) => sum + data.confidence, 0) / totalPredictions;
            const conclusion = benignCount > spoofingCount ? 'Liveness' : 'Spoofing Attack';

            setFinalAccuracy({ averageConfidence, totalPredictions, benignCount, printAttackCount, replayAttackCount, conclusion });
        } else {
            setFinalAccuracy({ averageConfidence: 0, totalPredictions: 0, benignCount: 0, printAttackCount: 0, replayAttackCount: 0, conclusion: 'Spoofing Attack' });
        }
        setShowResults(true);
    }, []);

    // Fungsi untuk menghentikan proses koleksi data
    const stopCollection = useCallback(() => {
        if (isCollectingRef.current) {
            console.log('Stopping collection...');
            if (collectionTimerRef.current) clearTimeout(collectionTimerRef.current);
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
            setIsCollecting(false);
            calculateAndShowResults(accuracyDataRef.current);
        }
    }, [calculateAndShowResults]);

    // Effect untuk koneksi socket
    useEffect(() => {
        socketRef.current = io(socketURL);

        // socketRef.current.on("prediction_result", (data: { className: string; confidence: number }) => {
        //     // Panggil fungsi proses prediksi dengan data dari server
        //     processPrediction(data); 
        // });

        socketRef.current.on("connect_error", (err) => {
            console.error("[socket] Connection Error:", err);
            setPrediction({ className: "Connection Error", confidence: 0 });
        });
        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, []);

    // Fungsi untuk memproses setiap prediksi (dummy)
    const processPrediction = (data: { className: string; confidence: number }) => {
        setPrediction(data);
        temporalCheckerRef.current.addPrediction(data.className);
        setFinalDecision(temporalCheckerRef.current.getDecision());
        if (isCollectingRef.current) {
            setAccuracyData(prev => [...prev, data]);
        }
    };

    // Fungsi untuk menangkap frame dari webcam dan mengirimkannya
    const captureFrame = () => {
        if (isCameraOn && webcamRef.current) {
            const imageSrc = webcamRef.current.getScreenshot();
            if (imageSrc) {
                const base64String = imageSrc.replace("data:image/jpeg;base64,", "");
                socketRef.current?.emit("image", { image: base64String });
                const dummyResult = generateDummyPrediction();
                processPrediction(dummyResult);
            }
        }
    };

    // Effect untuk menjalankan pengambilan frame secara periodik
    useEffect(() => {
        if (isCameraOn) {
            const interval = setInterval(() => {
                captureFrame();
            }, 200); // Kirim frame setiap 200ms
            return () => clearInterval(interval);
        }
    }, [isCameraOn]);

    // Fungsi untuk memulai proses koleksi data selama 10 detik
    const startCollection = () => {
        console.log(`Starting collection for 10 seconds...`);
        setAccuracyData([]);
        setFinalAccuracy(null);
        setShowResults(false);
        setIsCollecting(true);
        setCountdown(10);

        if (collectionTimerRef.current) clearTimeout(collectionTimerRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

        countdownIntervalRef.current = setInterval(() => {
            setCountdown(prev => prev > 0 ? prev - 1 : 0);
        }, 1000);

        collectionTimerRef.current = setTimeout(() => {
            console.log('10 second collection time ended.');
            stopCollection();
        }, 10000); // 10 detik
    };

    // Fungsi untuk menyalakan/mematikan kamera
    const toggleCamera = () => {
        const turningOff = !isCameraOn;
        if (turningOff) {
            if (isCollecting) {
                stopCollection();
            }
            setPrediction(null);
            setFinalDecision("UNCERTAIN");
        }
        setIsCameraOn(prevState => !prevState);
    };
    
    // Fungsi untuk mendapatkan properti UI status
    const getStatusUI = () => {
        if (!isCameraOn) {
            return { color: "text-gray-500", iconName: "question" as const, text: "Kamera tidak aktif" };
        }
        if (showResults && finalAccuracy) {
            return finalAccuracy.conclusion === 'Liveness'
                ? { color: "text-green-500", iconName: "check" as const, text: "Liveness Terkonfirmasi" }
                : { color: "text-red-500", iconName: "times" as const, text: "Serangan Spoof Terdeteksi" };
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

    const statusUI = getStatusUI();

    // Render komponen (JSX)
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
            <div className="w-full max-w-2xl bg-white p-8 rounded-2xl shadow-lg text-center">
                <h1 className="text-3xl font-bold text-gray-800 mb-2">Verifikasi Liveness</h1>
                <p className="text-gray-600 mb-6">Posisikan wajah Anda di dalam bingkai.</p>

                {isCollecting && (
                    <div className="mb-4 p-3 bg-blue-100 rounded-lg">
                        <p className="text-lg font-semibold text-blue-800 animate-pulse">
                            Mengumpulkan data... Sisa Waktu: {countdown} detik
                        </p>
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
                    {prediction && isCameraOn && !isCollecting && (
                        <p className="text-lg mt-2 text-gray-500">
                            Frame Saat Ini: <span className="font-semibold">{prediction.className}</span> ({Math.round(prediction.confidence * 100)}%)
                        </p>
                    )}
                </div>

                {showResults && finalAccuracy && (
                     <div className="mt-6 p-4 bg-gray-50 rounded-lg border-2 border-blue-200">
                        <h3 className="text-xl font-bold text-gray-800 mb-3">Hasil Deteksi ({finalAccuracy.totalPredictions} Prediksi)</h3>
                        <div className="grid grid-cols-2 gap-4 mb-4 text-left">
                            <div className="p-3 bg-green-100 rounded-lg">
                                <p className="font-bold text-green-800">Deteksi Liveness</p>
                                <p className="text-2xl font-bold text-green-600">{finalAccuracy.benignCount}</p>
                            </div>
                            <div className="p-3 bg-red-100 rounded-lg">
                                <p className="font-bold text-red-800">Deteksi Spoof</p>
                                <p className="text-2xl font-bold text-red-600">{finalAccuracy.printAttackCount + finalAccuracy.replayAttackCount}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-4 text-left">
                            <div className="p-2 bg-gray-100 rounded">
                                <p className="text-sm font-semibold text-gray-700">Real</p>
                                <p className="font-bold text-gray-900">{finalAccuracy.benignCount}</p>
                            </div>
                            <div className="p-2 bg-gray-100 rounded">
                                <p className="text-sm font-semibold text-gray-700">Print Attack</p>
                                <p className="font-bold text-gray-900">{finalAccuracy.printAttackCount}</p>
                            </div>
                            <div className="p-2 bg-gray-100 rounded">
                                <p className="text-sm font-semibold text-gray-700">Replay Attack</p>
                                <p className="font-bold text-gray-900">{finalAccuracy.replayAttackCount}</p>
                            </div>
                        </div>
                        <div className={`p-4 rounded-lg border-2 ${finalAccuracy.conclusion === 'Liveness' ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
                            <p className="font-bold text-lg">{finalAccuracy.conclusion === 'Liveness' ? 'Kesimpulan: Wajah Asli Terdeteksi' : 'Kesimpulan: Indikasi Serangan Spoofing'}</p>
                            <p className="text-sm">Rata-rata kepercayaan prediksi: {Math.round(finalAccuracy.averageConfidence * 100)}%</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="w-full max-w-2xl mt-6 space-y-3">
                <button
                    onClick={toggleCamera}
                    className={`w-full flex items-center justify-center gap-3 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300 ${isCameraOn ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'}`}
                >
                    {isCameraOn ? <FaVideoSlash size={20} /> : <FaVideo size={20} />}
                    <span>{isCameraOn ? 'Matikan Kamera' : 'Nyalakan Kamera'}</span>
                </button>

                {isCameraOn && !isCollecting && (
                    <button
                        onClick={startCollection}
                        className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300"
                    >
                        <FaPlay size={20} />
                        <span>{showResults ? 'Mulai Lagi' : 'Mulai Pengumpulan Data (10 Detik)'}</span>
                    </button>
                )}
            </div>
        </div>
    );
}
