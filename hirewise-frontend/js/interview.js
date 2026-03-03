// =====================================================================
// InterviewManager  —  Voice-only Vapi Interview with Camera & Mic
// =====================================================================
class InterviewManager {
    constructor() {
        this.vapiInstance = null;
        this.vapiTranscript = [];
        this.vapiSessionId = null;
        this.vapiCallActive = false;
        this.mediaStream = null;
        this.timerInterval = null;
        this.seconds = 0;
    }

    // -----------------------------------------------------------------
    //  SETUP MODAL  (resume picker + JD + device check)
    // -----------------------------------------------------------------
    async openSetupModal() {
        document.getElementById('interview-setup-modal')?.remove();

        // Fetch existing resumes
        let resumes = [];
        try {
            const res = await API.getUserResumes();
            if (res.success && res.data) resumes = res.data;
        } catch (e) { console.error('Failed to load resumes:', e); }

        const user = Storage.getUser();
        const candidateName = user?.fullName || '';

        const resumeOptions = resumes.map(function(r) {
            return '<option value="' + r.resumeId + '">' + r.fileName + (r.atsScore ? ' (ATS: ' + r.atsScore + ')' : '') + '</option>';
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'interview-setup-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = '<div class="modal max-w-2xl p-0" style="max-height:90vh;overflow-y:auto;">' +
            '<div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(0,172,193,.2)">' +
                '<h2 class="text-2xl font-bold text-white">Start Voice Interview</h2>' +
                '<button class="close-modal text-gray-400 hover:text-white text-2xl leading-none" id="close-setup-modal">&times;</button>' +
            '</div>' +
            '<div class="modal-body" style="padding:1.5rem">' +
                '<form id="interview-setup-form" class="space-y-5">' +
                    '<div>' +
                        '<label class="block text-sm font-medium mb-2">Resume <span class="text-red-400">*</span></label>' +
                        (resumes.length > 0 ? (
                            '<div class="mb-3">' +
                                '<label class="block text-xs text-gray-400 mb-1">Choose from your existing resumes</label>' +
                                '<select id="iv-resume-select" class="w-full px-4 py-2 bg-primary-dark border border-accent-cyan/20 rounded-lg focus:border-accent-cyan focus:outline-none text-white">' +
                                    '<option value="">-- Select a resume --</option>' +
                                    resumeOptions +
                                '</select>' +
                            '</div>' +
                            '<div class="flex items-center gap-3 my-3">' +
                                '<div class="flex-1 h-px bg-gray-700"></div>' +
                                '<span class="text-xs text-gray-500">OR</span>' +
                                '<div class="flex-1 h-px bg-gray-700"></div>' +
                            '</div>'
                        ) : '') +
                        '<label class="block text-xs text-gray-400 mb-1">Upload a new resume (PDF)</label>' +
                        '<div id="iv-resume-drop" class="border-2 border-dashed border-accent-cyan/30 rounded-lg p-5 text-center cursor-pointer hover:border-accent-cyan/60 transition">' +
                            '<p class="text-sm text-gray-400" id="iv-resume-label">Click or drag &amp; drop your resume here</p>' +
                            '<input type="file" id="iv-resume-file" accept=".pdf,.txt,.doc,.docx" class="hidden">' +
                        '</div>' +
                    '</div>' +
                    '<div>' +
                        '<label class="block text-sm font-medium mb-1">Job Description <span class="text-red-400">*</span></label>' +
                        '<textarea id="iv-job-description" rows="4" required placeholder="Paste the job description here..." class="w-full px-4 py-2 bg-primary-dark border border-accent-cyan/20 rounded-lg focus:border-accent-cyan focus:outline-none text-white text-sm"></textarea>' +
                    '</div>' +
                    '<div class="p-4 rounded-lg border border-accent-cyan/20" style="background:rgba(0,172,193,.05)">' +
                        '<h4 class="text-sm font-semibold mb-3 text-accent-cyan">Device Check</h4>' +
                        '<div class="flex items-center gap-6">' +
                            '<div class="flex items-center gap-2">' +
                                '<span id="iv-mic-icon" class="text-lg">&#x1F3A4;</span>' +
                                '<span id="iv-mic-status" class="text-sm text-gray-400">Checking mic...</span>' +
                            '</div>' +
                            '<div class="flex items-center gap-2">' +
                                '<span id="iv-cam-icon" class="text-lg">&#x1F4F7;</span>' +
                                '<span id="iv-cam-status" class="text-sm text-gray-400">Checking camera...</span>' +
                            '</div>' +
                        '</div>' +
                        '<button type="button" id="iv-check-devices" class="mt-3 text-xs text-accent-cyan hover:underline">Re-check devices</button>' +
                    '</div>' +
                    '<button type="submit" id="iv-start-btn" disabled class="w-full px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed">Start Voice Interview</button>' +
                '</form>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);
        this._bindSetupEvents();
        this._checkDevices();
    }

    _bindSetupEvents() {
        // Close
        document.getElementById('close-setup-modal').onclick = function() {
            document.getElementById('interview-setup-modal')?.remove();
        };

        // Resume drop zone
        var dropZone = document.getElementById('iv-resume-drop');
        var fileInput = document.getElementById('iv-resume-file');
        dropZone.onclick = function() { fileInput.click(); };
        dropZone.ondragover = function(e) { e.preventDefault(); dropZone.classList.add('border-accent-cyan'); };
        dropZone.ondragleave = function() { dropZone.classList.remove('border-accent-cyan'); };
        dropZone.ondrop = function(e) {
            e.preventDefault();
            dropZone.classList.remove('border-accent-cyan');
            if (e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                document.getElementById('iv-resume-label').textContent = e.dataTransfer.files[0].name;
                var sel = document.getElementById('iv-resume-select');
                if (sel) sel.value = '';
            }
        };
        fileInput.onchange = function() {
            if (fileInput.files.length) {
                document.getElementById('iv-resume-label').textContent = fileInput.files[0].name;
                var sel = document.getElementById('iv-resume-select');
                if (sel) sel.value = '';
            }
        };

        // If resume select changes, clear file input
        var sel = document.getElementById('iv-resume-select');
        if (sel) {
            sel.onchange = function() {
                if (sel.value) {
                    fileInput.value = '';
                    document.getElementById('iv-resume-label').textContent = 'Click or drag & drop your resume here';
                }
            };
        }

        // Device re-check
        var self = this;
        document.getElementById('iv-check-devices').onclick = function() { self._checkDevices(); };

        // Form submit
        document.getElementById('interview-setup-form').onsubmit = function(e) {
            e.preventDefault();
            self._handleSetupSubmit();
        };
    }

    async _checkDevices() {
        var micStatus = document.getElementById('iv-mic-status');
        var camStatus = document.getElementById('iv-cam-status');
        var micIcon = document.getElementById('iv-mic-icon');
        var camIcon = document.getElementById('iv-cam-icon');
        var startBtn = document.getElementById('iv-start-btn');

        micStatus.textContent = 'Checking...';
        camStatus.textContent = 'Checking...';
        micStatus.className = 'text-sm text-gray-400';
        camStatus.className = 'text-sm text-gray-400';

        var micOk = false;
        var camOk = false;

        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            micOk = true;
            camOk = true;
            stream.getTracks().forEach(function(t) { t.stop(); });
        } catch (err) {
            console.warn('Device check error:', err.name);
            try {
                var audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                micOk = true;
                audioStream.getTracks().forEach(function(t) { t.stop(); });
            } catch (e2) { /* mic failed */ }
            try {
                var videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                camOk = true;
                videoStream.getTracks().forEach(function(t) { t.stop(); });
            } catch (e2) { /* cam failed */ }
        }

        micIcon.textContent = micOk ? '\u2705' : '\u274C';
        micStatus.textContent = micOk ? 'Microphone ready' : 'Microphone not found';
        micStatus.className = micOk ? 'text-sm text-green-400' : 'text-sm text-red-400';

        camIcon.textContent = camOk ? '\u2705' : '\u274C';
        camStatus.textContent = camOk ? 'Camera ready' : 'Camera not found';
        camStatus.className = camOk ? 'text-sm text-green-400' : 'text-sm text-red-400';

        if (startBtn) {
            startBtn.disabled = !(micOk && camOk);
        }

        return { micOk: micOk, camOk: camOk };
    }

    async _handleSetupSubmit() {
        var btn = document.getElementById('iv-start-btn');
        btn.disabled = true;
        btn.textContent = 'Starting...';

        try {
            var user = Storage.getUser();
            var candidateName = user?.fullName || 'Candidate';
            var userId = user?.userId;
            if (!userId) { alert('Please log in first.'); btn.disabled = false; btn.textContent = 'Start Voice Interview'; return; }

            var jobDescription = document.getElementById('iv-job-description').value.trim();
            if (!jobDescription) { alert('Job description is required.'); btn.disabled = false; btn.textContent = 'Start Voice Interview'; return; }

            var resumeSelect = document.getElementById('iv-resume-select');
            var resumeId = resumeSelect ? resumeSelect.value : '';
            var resumeFile = document.getElementById('iv-resume-file').files[0];

            if (!resumeId && !resumeFile) {
                alert('Please select or upload a resume.');
                btn.disabled = false;
                btn.textContent = 'Start Voice Interview';
                return;
            }

            var formData = new FormData();
            formData.append('candidate_name', candidateName);
            formData.append('job_description', jobDescription);
            formData.append('user_id', userId);
            if (resumeId) formData.append('resume_id', resumeId);
            if (resumeFile) formData.append('resume', resumeFile);

            var result = await API.startVapiInterview(formData);
            if (!result.success) {
                alert(result.message || 'Failed to start interview');
                btn.disabled = false;
                btn.textContent = 'Start Voice Interview';
                return;
            }

            var data = result.data;
            this.vapiSessionId = data.session_id;
            this.vapiTranscript = [];
            this.vapiCallActive = false;

            // Close setup modal & open interview modal
            document.getElementById('interview-setup-modal')?.remove();
            this._openInterviewModal(data);

        } catch (err) {
            console.error('Interview start error:', err);
            alert('Failed to start interview: ' + err.message);
            btn.disabled = false;
            btn.textContent = 'Start Voice Interview';
        }
    }

    // =================================================================
    //  INTERVIEW MODAL  (camera + transcript + Vapi)
    // =================================================================
    async _openInterviewModal(data) {
        document.getElementById('voice-interview-modal')?.remove();

        var modal = document.createElement('div');
        modal.id = 'voice-interview-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = '<div class="modal max-w-5xl p-0" style="max-height:95vh;display:flex;flex-direction:column">' +
            '<div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-bottom:1px solid rgba(0,172,193,.2);flex-shrink:0">' +
                '<div class="flex items-center gap-3">' +
                    '<h2 class="text-xl font-bold">Voice Interview</h2>' +
                    '<span class="text-accent-cyan font-mono text-sm" id="vi-timer">00:00</span>' +
                '</div>' +
                '<div class="flex items-center gap-3">' +
                    '<span id="vi-connection-status" class="text-xs text-gray-500">Ready</span>' +
                    '<button class="text-gray-400 hover:text-white text-2xl leading-none" id="vi-close">&times;</button>' +
                '</div>' +
            '</div>' +
            '<div class="modal-body" style="padding:1.5rem;flex:1;overflow-y:auto;display:flex;gap:1.5rem;min-height:0">' +
                '<div class="flex flex-col items-center" style="width:320px;flex-shrink:0">' +
                    '<div class="relative w-full rounded-xl overflow-hidden border-2 border-accent-cyan/30 mb-4" style="aspect-ratio:4/3;background:#000">' +
                        '<video id="vi-camera" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>' +
                        '<div id="vi-camera-off" class="absolute inset-0 flex items-center justify-center bg-gray-900/80 hidden"><span class="text-gray-500 text-sm">Camera off</span></div>' +
                    '</div>' +
                    '<div class="text-center">' +
                        '<div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent-cyan/10 border-2 border-accent-cyan/30 mb-2" id="vi-avatar-ring">' +
                            '<span class="text-3xl">&#x1F916;</span>' +
                        '</div>' +
                        '<p class="text-sm font-semibold">Laxon &bull; AI Interviewer</p>' +
                        '<p class="text-xs text-gray-400" id="vi-status">Click Start to begin</p>' +
                    '</div>' +
                    '<div class="flex justify-center gap-3 mt-4">' +
                        '<button id="vi-start-btn" class="px-6 py-2 bg-green-600 text-white rounded-full hover:bg-green-500 transition font-semibold text-sm flex items-center gap-2">&#9654; Start</button>' +
                        '<button id="vi-stop-btn" class="hidden px-6 py-2 bg-red-600 text-white rounded-full hover:bg-red-500 transition font-semibold text-sm flex items-center gap-2">&#9724; End Interview</button>' +
                    '</div>' +
                '</div>' +
                '<div class="flex-1 flex flex-col min-w-0">' +
                    '<h4 class="text-sm font-semibold text-accent-cyan mb-2">Live Transcript</h4>' +
                    '<div id="vi-transcript" class="flex-1 overflow-y-auto space-y-2 border border-accent-cyan/10 rounded-lg p-3" style="background:rgba(0,0,0,.2);min-height:200px;max-height:500px">' +
                        '<p class="text-center text-sm text-gray-500">Transcript will appear here once the interview starts...</p>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);

        // Start camera
        await this._startCamera();

        // Timer
        this._startTimer();

        var self = this;

        // Close
        document.getElementById('vi-close').onclick = function() {
            if (self.vapiCallActive) {
                if (!confirm('End the voice interview?')) return;
                self._endVapiCall();
            }
            self._cleanup();
            document.getElementById('voice-interview-modal')?.remove();
        };

        // Start button
        document.getElementById('vi-start-btn').onclick = function() { self._initiateVapiCall(data); };

        // Stop button
        document.getElementById('vi-stop-btn').onclick = function() { self._endVapiCall(); };
    }

    async _startCamera() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            var video = document.getElementById('vi-camera');
            if (video) {
                video.srcObject = this.mediaStream;
            }
        } catch (err) {
            console.warn('Camera access failed:', err);
            var offEl = document.getElementById('vi-camera-off');
            if (offEl) offEl.classList.remove('hidden');
        }
    }

    _startTimer() {
        clearInterval(this.timerInterval);
        this.seconds = 0;
        var self = this;
        this.timerInterval = setInterval(function() {
            self.seconds++;
            var m = String(Math.floor(self.seconds / 60)).padStart(2, '0');
            var s = String(self.seconds % 60).padStart(2, '0');
            var el = document.getElementById('vi-timer');
            if (el) el.textContent = m + ':' + s;
        }, 1000);
    }

    // =================================================================
    //  VAPI CALL
    // =================================================================
    async _initiateVapiCall(data) {
        var startBtn = document.getElementById('vi-start-btn');
        var stopBtn = document.getElementById('vi-stop-btn');
        var status = document.getElementById('vi-status');
        var connStatus = document.getElementById('vi-connection-status');

        startBtn.disabled = true;
        startBtn.textContent = 'Connecting...';
        status.textContent = 'Connecting to AI interviewer...';
        connStatus.textContent = 'Connecting...';
        connStatus.className = 'text-xs text-yellow-400';

        var self = this;

        try {
            // Load Vapi SDK if needed
            if (!window.Vapi) {
                await this._loadVapiSDK();
            }

            this.vapiInstance = new window.Vapi(data.vapi_public_key);
            this.vapiTranscript = [];

            // Events
            this.vapiInstance.on('speech-start', function() {
                document.getElementById('vi-avatar-ring')?.classList.add('animate-pulse');
            });

            this.vapiInstance.on('speech-end', function() {
                document.getElementById('vi-avatar-ring')?.classList.remove('animate-pulse');
            });

            this.vapiInstance.on('message', function(msg) {
                if (msg.type === 'transcript' && msg.transcriptType === 'final') {
                    self.vapiTranscript.push({ role: msg.role, text: msg.transcript });
                    self._addTranscriptMessage(msg.role, msg.transcript);
                }
            });

            this.vapiInstance.on('call-start', function() {
                self.vapiCallActive = true;
                startBtn.classList.add('hidden');
                stopBtn.classList.remove('hidden');
                status.textContent = 'Interview in progress \u2014 speak naturally';
                connStatus.textContent = 'Connected';
                connStatus.className = 'text-xs text-green-400';
                document.getElementById('vi-transcript').innerHTML = '';
            });

            this.vapiInstance.on('call-end', function() {
                self.vapiCallActive = false;
                stopBtn.classList.add('hidden');
                status.textContent = 'Interview ended. Generating report...';
                connStatus.textContent = 'Disconnected';
                connStatus.className = 'text-xs text-gray-500';
                document.getElementById('vi-avatar-ring')?.classList.remove('animate-pulse');
                self._generateReport();
            });

            this.vapiInstance.on('error', function(err) {
                console.error('Vapi error:', err);
                status.textContent = 'Connection error. Please try again.';
                connStatus.textContent = 'Error';
                connStatus.className = 'text-xs text-red-400';
                startBtn.classList.remove('hidden');
                startBtn.disabled = false;
                startBtn.innerHTML = '&#9654; Retry';
                stopBtn.classList.add('hidden');
                self.vapiCallActive = false;
            });

            // Start call
            await this.vapiInstance.start(data.assistant_config);

        } catch (err) {
            console.error('Vapi start error:', err);
            status.textContent = 'Failed to start: ' + err.message;
            startBtn.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.innerHTML = '&#9654; Retry';
        }
    }

    _addTranscriptMessage(role, text) {
        var container = document.getElementById('vi-transcript');
        if (!container) return;
        var isAI = (role === 'assistant');
        var div = document.createElement('div');
        div.className = 'flex gap-2 items-start ' + (isAI ? '' : 'justify-end');
        div.innerHTML = '<div class="' + (isAI ? 'bg-accent-cyan/10 border-accent-cyan/20' : 'bg-gray-700/60 border-gray-600/40') + ' border rounded-lg px-3 py-2 max-w-[85%]">' +
            '<p class="text-xs ' + (isAI ? 'text-accent-cyan' : 'text-gray-400') + ' mb-0.5">' + (isAI ? '&#x1F916; Laxon' : '&#x1F464; You') + '</p>' +
            '<p class="text-sm text-gray-200">' + text + '</p>' +
        '</div>';
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    _endVapiCall() {
        if (this.vapiInstance) {
            try { this.vapiInstance.stop(); } catch(e) { console.error(e); }
        }
    }

    async _generateReport() {
        var status = document.getElementById('vi-status');
        if (status) status.textContent = 'Analyzing transcript and generating report...';

        var result = await API.submitVapiReport(this.vapiSessionId, this.vapiTranscript);
        this._cleanup();

        if (result.success) {
            document.getElementById('voice-interview-modal')?.remove();
            this._showReport(result.data.report);
        } else {
            if (status) status.textContent = 'Failed to generate report: ' + (result.message || 'Unknown error');
        }
    }

    _cleanup() {
        clearInterval(this.timerInterval);
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(function(t) { t.stop(); });
            this.mediaStream = null;
        }
    }

    // =================================================================
    //  REPORT VIEW
    // =================================================================
    _showReport(report) {
        this._cleanup();
        document.getElementById('voice-interview-modal')?.remove();

        if (!report) { alert('Report not available.'); return; }

        var verdictColor = '#6b7280';
        if (report.overall_verdict === 'Strong Hire') verdictColor = '#22c55e';
        else if (report.overall_verdict === 'Hire') verdictColor = '#3b82f6';
        else if (report.overall_verdict === 'Maybe') verdictColor = '#f59e0b';
        else if (report.overall_verdict === 'No Hire') verdictColor = '#ef4444';

        var strengthsHtml = (report.top_strengths || []).map(function(s) { return '<li>' + s + '</li>'; }).join('');
        var gapsHtml = (report.key_gaps || []).map(function(s) { return '<li>' + s + '</li>'; }).join('');

        var qaPairsHtml = '';
        if (report.qa_pairs && report.qa_pairs.length > 0) {
            qaPairsHtml = '<h4 class="font-semibold text-accent-cyan mb-3">Question-by-Question Breakdown</h4><div class="space-y-3">';
            report.qa_pairs.forEach(function(qa, i) {
                var strengthsLine = (qa.strengths && qa.strengths.length) ? '<p class="text-green-400 text-xs">' + qa.strengths.join(' | ') + '</p>' : '';
                var improvementsLine = (qa.improvements && qa.improvements.length) ? '<p class="text-yellow-400 text-xs">' + qa.improvements.join(' | ') + '</p>' : '';
                var qText = (qa.question || '').substring(0, 80) + ((qa.question || '').length > 80 ? '...' : '');
                qaPairsHtml += '<details class="border border-accent-cyan/10 rounded-lg overflow-hidden">' +
                    '<summary class="px-4 py-3 cursor-pointer hover:bg-accent-cyan/5 flex items-center justify-between">' +
                        '<span class="text-sm">Q' + (i+1) + ': ' + qText + '</span>' +
                        '<span class="text-xs px-2 py-0.5 rounded" style="background:rgba(0,172,193,.15);color:#00acc1">' + qa.score + '/10</span>' +
                    '</summary>' +
                    '<div class="px-4 py-3 border-t border-accent-cyan/10 text-sm space-y-2" style="background:rgba(0,0,0,.15)">' +
                        '<p><strong class="text-gray-400">Answer:</strong> ' + (qa.answer || 'N/A') + '</p>' +
                        '<p><strong class="text-gray-400">Verdict:</strong> ' + (qa.verdict || '') + '</p>' +
                        strengthsLine + improvementsLine +
                    '</div>' +
                '</details>';
            });
            qaPairsHtml += '</div>';
        }

        var modal = document.createElement('div');
        modal.id = 'interview-report-modal';
        modal.className = 'modal-backdrop';
        modal.innerHTML = '<div class="modal max-w-3xl p-0" style="max-height:90vh;display:flex;flex-direction:column">' +
            '<div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem;border-bottom:1px solid rgba(0,172,193,.2);flex-shrink:0">' +
                '<h2 class="text-xl font-bold">Interview Report</h2>' +
                '<button class="text-gray-400 hover:text-white text-2xl leading-none" id="close-report-modal">&times;</button>' +
            '</div>' +
            '<div class="modal-body" style="padding:1.5rem;flex:1;overflow-y:auto">' +
                '<div class="text-center mb-6">' +
                    '<div class="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 mb-3" style="border-color:' + verdictColor + '">' +
                        '<span class="text-3xl font-bold" style="color:' + verdictColor + '">' + report.overall_score + '</span>' +
                    '</div>' +
                    '<p class="text-xl font-bold" style="color:' + verdictColor + '">' + report.overall_verdict + '</p>' +
                    '<p class="text-gray-400 text-sm mt-2 max-w-lg mx-auto">' + (report.summary || '') + '</p>' +
                '</div>' +
                '<div class="grid grid-cols-2 gap-4 mb-6">' +
                    '<div class="p-4 rounded-lg border border-green-500/20" style="background:rgba(34,197,94,.05)">' +
                        '<h4 class="font-semibold text-green-400 mb-2">Top Strengths</h4>' +
                        '<ul class="list-disc list-inside text-sm text-gray-300 space-y-1">' + strengthsHtml + '</ul>' +
                    '</div>' +
                    '<div class="p-4 rounded-lg border border-yellow-500/20" style="background:rgba(245,158,11,.05)">' +
                        '<h4 class="font-semibold text-yellow-400 mb-2">Key Gaps</h4>' +
                        '<ul class="list-disc list-inside text-sm text-gray-300 space-y-1">' + gapsHtml + '</ul>' +
                    '</div>' +
                '</div>' +
                '<p class="text-sm text-gray-400 mb-6"><strong class="text-accent-cyan">Recommendation:</strong> ' + (report.recommendation || '') + '</p>' +
                qaPairsHtml +
            '</div>' +
            '<div class="modal-footer" style="padding:1rem 1.5rem;border-top:1px solid rgba(0,172,193,.2);flex-shrink:0;text-align:right">' +
                '<button id="done-report-btn" class="px-6 py-2 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition font-semibold">Done</button>' +
            '</div>' +
        '</div>';
        document.body.appendChild(modal);

        document.getElementById('close-report-modal').onclick = function() {
            document.getElementById('interview-report-modal')?.remove();
        };
        document.getElementById('done-report-btn').onclick = function() {
            document.getElementById('interview-report-modal')?.remove();
        };
    }

    // =================================================================
    //  HELPERS
    // =================================================================
    async _loadVapiSDK() {
        if (window.Vapi && typeof window.Vapi === 'function') return;
        try {
            // jsdelivr +esm wraps CJS exports as the default export object.
            // The actual Vapi class lives at module.default.default (the CJS exports.default).
            var mod = await import('https://cdn.jsdelivr.net/npm/@vapi-ai/web@2.5.2/+esm');
            var VapiClass = mod.default?.default   // CJS exports.default  ← correct
                         || mod.default            // fallback if plain default export
                         || mod.Vapi;              // named export fallback
            console.log('Vapi module loaded, type of VapiClass:', typeof VapiClass);
            if (typeof VapiClass !== 'function') {
                throw new Error('Vapi class not found — got: ' + typeof VapiClass);
            }
            window.Vapi = VapiClass;
            console.log('Vapi SDK ready');
        } catch(err) {
            console.error('Failed to load Vapi SDK:', err);
            throw new Error('Failed to load Vapi SDK: ' + err.message);
        }
    }

    // Called from dashboard to view a past session report
    async loadSessionReport(sessionId) {
        try {
            var result = await API.getInterviewReport(sessionId);
            if (result.success && result.data && result.data.report) {
                this._showReport(result.data.report);
            } else {
                alert(result.message || 'Report not available for this session.');
            }
        } catch (err) {
            console.error('Error loading report:', err);
            alert('Failed to load report.');
        }
    }

    // Legacy alias
    startInterview() { this.openSetupModal(); }
}

// Singleton
InterviewManager.instance = new InterviewManager();
if (typeof window !== 'undefined') window.InterviewManager = InterviewManager;
