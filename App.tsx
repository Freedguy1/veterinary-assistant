
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Chat, LiveSession, Modality, Blob as GenAIBlob, GenerateContentResponse } from "@google/genai";
import { AppView, ChatMessage } from './types';
import { encode } from './utils';

// --- ICONS (as stateless components) ---
const MicIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM10.5 5a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0V5Z" /><path d="M12 16.5a4.5 4.5 0 0 1-4.5-4.5H6a6 6 0 0 0 5.25 5.954V21h1.5v-2.546A6 6 0 0 0 18 12h-1.5a4.5 4.5 0 0 1-4.5 4.5Z" /></svg>
);
const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8.25 6.75a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5h-7.5Z" /></svg>
);
const SendIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg>
);

// --- API Client ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

// --- Summarizer View Component ---
const SummarizerView: React.FC = () => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [summary, setSummary] = useState('');
    const [isLoadingSummary, setIsLoadingSummary] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sessionRef = useRef<Promise<LiveSession> | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const fullTranscriptRef = useRef('');

    const generateSummary = useCallback(async (text: string) => {
        setIsLoadingSummary(true);
        setError(null);
        try {
            const prompt = `Ви — досвідчений ветеринарний асистент. Ваше завдання — проаналізувати наступну розшифровку розмови між ветеринаром і власником домашньої тварини. Витягніть ключову інформацію та надайте структурований підсумок. Підсумок має бути коротким, чітким та організованим у такі розділи: Історія тварини, Скарги власника, Спостережувані симптоми, Проведені маніпуляції та Попередні висновки. Якщо в будь-якому розділі немає відповідної інформації в стенограмі, вкажіть "Не згадано".
---
ТРАНСКРИПЦІЯ:
${text}
---
ПІДСУМОК:`;

            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            setSummary(response.text);
        } catch (err) {
            console.error('Failed to generate summary:', err);
            setError('Не вдалося створити підсумок. Будь ласка, спробуйте ще раз.');
        } finally {
            setIsLoadingSummary(false);
        }
    }, []);

    const stopRecording = useCallback(async (shouldSummarize = true) => {
        setIsRecording(false);
        
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            await audioContextRef.current.close();
            audioContextRef.current = null;
        }
        
        if (sessionRef.current) {
            const sessionPromise = sessionRef.current;
            sessionRef.current = null;
            try {
                const session = await sessionPromise;
                session.close();
            } catch (e) {
                console.error("Error closing session:", e);
            }
        }

        if (shouldSummarize && fullTranscriptRef.current.trim().length > 0) {
            generateSummary(fullTranscriptRef.current);
        }
    }, [generateSummary]);

    const startRecording = async () => {
        setError(null);
        setTranscript('');
        setSummary('');
        fullTranscriptRef.current = '';
        setIsRecording(true);

        try {
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            sessionRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    inputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                },
                callbacks: {
                    onopen: () => console.log('Live session opened.'),
                    onmessage: (message) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            setTranscript(prev => prev + text);
                            fullTranscriptRef.current += text;
                        }
                        if(message.serverContent?.turnComplete) {
                            setTranscript(prev => prev + ' ');
                            fullTranscriptRef.current += ' ';
                        }
                    },
                    onerror: (e) => {
                        console.error('Live session error:', e);
                        setError('Під час сеансу сталася помилка.');
                        stopRecording(false);
                    },
                    onclose: () => console.log('Live session closed.'),
                }
            });

            await sessionRef.current; // Wait for connection to establish

            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const pcmBlob: GenAIBlob = {
                    data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                    mimeType: 'audio/pcm;rate=16000',
                };
                sessionRef.current?.then((session) => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });
            };

            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioContextRef.current.destination);
        } catch (err) {
            console.error('Failed to start recording:', err);
            setError('Не вдалося розпочати сеанс. Перевірте дозволи мікрофона та з’єднання.');
            stopRecording(false);
        }
    };
    
    useEffect(() => {
        return () => {
           stopRecording(false);
        };
    }, [stopRecording]);

    return (
        <div className="flex flex-col items-center p-4">
            <button
                onClick={isRecording ? () => stopRecording() : startRecording}
                className="flex items-center justify-center w-24 h-24 rounded-full text-white shadow-lg transition-transform transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-opacity-50"
                aria-label={isRecording ? "Зупинити запис" : "Почати запис"}
            >
                {isRecording ? (
                    <div className="w-full h-full bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center focus:ring-red-400">
                        <StopIcon className="w-10 h-10" />
                    </div>
                ) : (
                    <div className="w-full h-full bg-primary-600 hover:bg-primary-700 rounded-full flex items-center justify-center focus:ring-primary-400">
                        <MicIcon className="w-10 h-10" />
                    </div>
                )}
            </button>
            <p className="mt-4 text-lg text-slate-600 dark:text-slate-300">
                {isRecording ? 'Запис консультації...' : 'Почніть запис, щоб почати'}
            </p>

            {error && <p className="mt-4 text-red-500">{error}</p>}
            
            <div className="w-full mt-8 space-y-6">
                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">Транскрипція в реальному часі</h2>
                    <div className="w-full h-48 p-3 bg-slate-50 dark:bg-slate-700 rounded-md overflow-y-auto text-slate-700 dark:text-slate-200" aria-live="polite">
                        {transcript || <span className="text-slate-400">Транскрипція з’явиться тут...</span>}
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-md">
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">Підсумок консультації</h2>
                    <div className="w-full min-h-48 p-3 bg-slate-50 dark:bg-slate-700 rounded-md text-slate-700 dark:text-slate-200">
                        {isLoadingSummary ? (
                           <div className="flex items-center justify-center h-full">
                               <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" role="status">
                                 <span className="sr-only">Завантаження...</span>
                               </div>
                           </div>
                        ) : summary ? (
                           <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">{summary}</div>
                        ) : (
                           <span className="text-slate-400">Підсумок буде створено тут після запису.</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Chat View Component ---
const ChatView: React.FC = () => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const chatRef = useRef<Chat | null>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        chatRef.current = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: 'Ви — корисний чат-бот ветеринарний асистент. Надавайте стислу та точну інформацію, пов\'язану з ветеринарною медициною. Не надавайте медичних порад, натомість порадьте звернутися до ліцензованого ветеринара.',
            },
        });
    }, []);
    
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: ChatMessage = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            if (chatRef.current) {
                const response: GenerateContentResponse = await chatRef.current.sendMessage({ message: input });
                const modelMessage: ChatMessage = { role: 'model', content: response.text };
                setMessages(prev => [...prev, modelMessage]);
            }
        } catch (err) {
            console.error('Chat error:', err);
            const errorMessage: ChatMessage = { role: 'model', content: 'Вибачте, сталася помилка. Будь ласка, спробуйте ще раз.' };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-220px)] w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg">
            <div ref={chatContainerRef} className="flex-1 p-6 space-y-4 overflow-y-auto">
                {messages.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-md p-3 rounded-xl ${msg.role === 'user' ? 'bg-primary-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'}`}>
                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                    </div>
                ))}
                {isLoading && (
                     <div className="flex justify-start">
                        <div className="max-w-sm p-3 rounded-xl bg-slate-200 dark:bg-slate-700">
                           <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse"></div>
                           </div>
                        </div>
                    </div>
                )}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700">
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Поставте запитання..."
                        className="flex-1 w-full px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500"
                        disabled={isLoading}
                        aria-label="Введення чату"
                    />
                    <button onClick={handleSend} disabled={!input.trim() || isLoading} className="p-2 text-white bg-primary-600 rounded-full hover:bg-primary-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors" aria-label="Надіслати повідомлення">
                        <SendIcon className="w-6 h-6"/>
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- Header and Main App Component ---
const Header: React.FC<{ activeView: AppView, setActiveView: (view: AppView) => void }> = ({ activeView, setActiveView }) => (
    <header className="w-full flex flex-col items-center p-6 bg-white dark:bg-slate-800 shadow-md rounded-b-xl">
        <h1 className="text-3xl font-bold text-primary-600 dark:text-primary-400">Ветеринарний ШІ-асистент</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">Ваш розумний партнер у догляді за тваринами.</p>
        <nav className="mt-6 flex space-x-2 p-1 bg-slate-200 dark:bg-slate-700 rounded-full" role="tablist" aria-label="Перегляди додатку">
            <button
                id="summarizer-tab"
                onClick={() => setActiveView(AppView.SUMMARIZER)}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${activeView === AppView.SUMMARIZER ? 'bg-white dark:bg-slate-900 text-primary-600 shadow' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
                role="tab"
                aria-selected={activeView === AppView.SUMMARIZER}
                aria-controls="summarizer-panel"
            >
                Підсумок
            </button>
            <button
                id="chat-tab"
                onClick={() => setActiveView(AppView.CHAT)}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-colors ${activeView === AppView.CHAT ? 'bg-white dark:bg-slate-900 text-primary-600 shadow' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'}`}
                role="tab"
                aria-selected={activeView === AppView.CHAT}
                aria-controls="chat-panel"
            >
                Чат-асистент
            </button>
        </nav>
    </header>
);

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<AppView>(AppView.SUMMARIZER);

    return (
        <div className="min-h-screen text-slate-900 dark:text-slate-50 flex flex-col items-center">
            <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
                <Header activeView={activeView} setActiveView={setActiveView} />
                <div className="mt-8">
                    <div id="summarizer-panel" role="tabpanel" aria-labelledby="summarizer-tab" hidden={activeView !== AppView.SUMMARIZER}>
                      <SummarizerView />
                    </div>
                     <div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" hidden={activeView !== AppView.CHAT}>
                      <ChatView />
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;
