class PianoRoll {
    constructor() {
        this.canvas = document.getElementById('pianoRollCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.timeRulerCanvas = document.getElementById('timeRulerCanvas');
        this.timeRulerCtx = this.timeRulerCanvas.getContext('2d');
        
        // Piano roll settings
        this.baseNoteHeight = 20;
        this.basePixelsPerBeat = 100;
        this.noteHeight = this.baseNoteHeight;
        this.beatsPerBar = 4;
        this.pixelsPerBeat = this.basePixelsPerBeat;
        this.snapToGrid = true;
        this.zoom = 1;
        
        // Note data
        this.notes = [];
        this.selectedNotes = [];
        
        // Interaction state
        this.currentTool = 'pencil';
        this.isDragging = false;
        this.isSelecting = false;
        this.dragStart = { x: 0, y: 0 };
        this.selectionBox = null;
        this.resizingNoteId = null;
        this.resizeEdge = null; // 'left' | 'right'
        
        // Playback
        this.isPlaying = false;
        this.currentTime = 0;
        this.playhead = null;
        this.audioCtx = null;
        this.playbackStartTime = 0;
        this.loopBeats = 64;
        this.scheduledStartTokens = new Set();
        
        // Piano keys
        this.noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        this.totalNotes = 88; // Piano range (A0 to C8)
        this.lowestNote = 21; // A0 = MIDI note 21
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.generatePianoKeys();
        this.setupEventListeners();
        this.draw();
        this.drawTimeRuler();
    }
    
    setupCanvas() {
        // Set canvas size
        this.canvas.width = Math.max(4000, this.loopBeats * this.pixelsPerBeat); // Wide canvas
        this.canvas.height = this.totalNotes * this.noteHeight;
        
        this.timeRulerCanvas.width = this.canvas.width;
        this.timeRulerCanvas.height = 30;
        
        // Style sizes
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';
        this.timeRulerCanvas.style.width = this.timeRulerCanvas.width + 'px';
        this.timeRulerCanvas.style.height = this.timeRulerCanvas.height + 'px';
    }
    
    generatePianoKeys() {
        const container = document.getElementById('pianoKeysContainer');
        container.innerHTML = '';
        
        for (let i = this.totalNotes - 1; i >= 0; i--) {
            const midiNote = this.lowestNote + i;
            const noteIndex = midiNote % 12;
            const octave = Math.floor(midiNote / 12) - 1;
            const noteName = this.noteNames[noteIndex] + octave;
            
            const keyElement = document.createElement('div');
            keyElement.className = 'piano-key';
            keyElement.dataset.midiNote = midiNote;
            keyElement.textContent = noteName;
            keyElement.style.height = this.noteHeight + 'px';
            
            const isBlackKey = [1, 3, 6, 8, 10].includes(noteIndex);
            keyElement.classList.add(isBlackKey ? 'black' : 'white');
            
            keyElement.addEventListener('mousedown', (e) => {
                this.playNote(midiNote, 0.2);
                keyElement.classList.add('active');
            });
            
            keyElement.addEventListener('mouseup', () => {
                keyElement.classList.remove('active');
            });
            
            keyElement.addEventListener('mouseleave', () => {
                keyElement.classList.remove('active');
            });
            
            container.appendChild(keyElement);
        }
    }
    
    setupEventListeners() {
        // Canvas mouse events
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Sync scroll of keys and time ruler with grid
        const gridScroll = document.querySelector('.grid-area');
        const keysPane = document.querySelector('.piano-keys');
        const timeRulerCanvas = this.timeRulerCanvas;
        gridScroll.addEventListener('scroll', () => {
            keysPane.scrollTop = gridScroll.scrollTop;
            timeRulerCanvas.style.transform = `translateX(${-gridScroll.scrollLeft}px)`;
        });
        
        // Tool buttons
        document.getElementById('selectTool').addEventListener('click', () => this.setTool('select'));
        document.getElementById('pencilTool').addEventListener('click', () => this.setTool('pencil'));
        document.getElementById('eraseTool').addEventListener('click', () => this.setTool('erase'));
        
        // Playback controls
        document.getElementById('playBtn').addEventListener('click', this.togglePlayback.bind(this));
        document.getElementById('stopBtn').addEventListener('click', this.stop.bind(this));
        
        // Zoom controls
        document.getElementById('zoomIn').addEventListener('click', () => this.adjustZoom(1.2));
        document.getElementById('zoomOut').addEventListener('click', () => this.adjustZoom(0.8));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        
        // Window resize
        window.addEventListener('resize', this.onResize.bind(this));
    }
    
    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        this.dragStart = { x, y };
        
        // Right click to erase
        if (e.button === 2) {
            this.deleteNoteAt(x, y);
            this.draw();
            return;
        }
        
        if (this.currentTool === 'pencil') {
            const hit = this.getNoteAt(x, y);
            if (hit && this.isNearEdge(x, hit)) {
                this.resizingNoteId = hit.id;
                this.resizeEdge = this.nearestEdge(x, hit);
                this.isDragging = true;
            } else if (hit) {
                this.selectedNotes = [hit];
                this.isDragging = true;
            } else {
                this.addNote(x, y);
            }
        } else if (this.currentTool === 'erase') {
            this.deleteNoteAt(x, y);
        } else if (this.currentTool === 'select') {
            const note = this.getNoteAt(x, y);
            if (note) {
                if (!e.shiftKey) {
                    this.selectedNotes = [note];
                } else {
                    this.toggleNoteSelection(note);
                }
                // Check resize
                if (this.isNearEdge(x, note)) {
                    this.resizingNoteId = note.id;
                    this.resizeEdge = this.nearestEdge(x, note);
                } else {
                    this.isDragging = true;
                }
            } else {
                if (!e.shiftKey) {
                    this.selectedNotes = [];
                }
                this.isSelecting = true;
                this.createSelectionBox(x, y);
            }
        }
        
        this.draw();
    }
    
    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const beat = Math.floor(x / this.pixelsPerBeat);
        const noteIndex = Math.floor(y / this.noteHeight);
        const midiNote = this.lowestNote + (this.totalNotes - 1 - noteIndex);
        const noteName = this.getNoteNameFromMidi(midiNote);
        document.getElementById('mousePosition').textContent = `Beat: ${beat}, Note: ${noteName}`;
        
        // Resize cursor feedback
        const hoverNote = this.getNoteAt(x, y);
        if (hoverNote && this.isNearEdge(x, hoverNote)) {
            this.canvas.style.cursor = this.nearestEdge(x, hoverNote) === 'left' ? 'w-resize' : 'e-resize';
        } else if (this.currentTool === 'pencil' || this.currentTool === 'erase') {
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }
        
        if (this.resizingNoteId) {
            const note = this.notes.find(n => n.id === this.resizingNoteId);
            if (note) {
                const mouseBeat = x / this.pixelsPerBeat;
                if (this.resizeEdge === 'right') {
                    const newDuration = Math.max(0.1, mouseBeat - note.beat);
                    note.duration = this.snapToGrid ? Math.max(0.25, Math.round(newDuration * 4) / 4) : newDuration;
                } else {
                    const newBeat = mouseBeat;
                    const rightEdge = note.beat + note.duration;
                    note.beat = this.snapToGrid ? Math.max(0, Math.round(newBeat * 4) / 4) : Math.max(0, newBeat);
                    note.duration = Math.max(0.1, rightEdge - note.beat);
                }
                this.draw();
            }
        } else if (this.isDragging && this.selectedNotes.length > 0) {
            const deltaX = x - this.dragStart.x;
            const deltaY = y - this.dragStart.y;
            this.moveSelectedNotes(deltaX, deltaY);
            this.dragStart = { x, y };
            this.draw();
        } else if (this.isSelecting) {
            this.updateSelectionBox(x, y);
        }
    }
    
    onMouseUp(e) {
        if (this.isSelecting) {
            this.finishSelection();
        }
        this.isDragging = false;
        this.isSelecting = false;
        this.resizingNoteId = null;
        this.resizeEdge = null;
        this.removeSelectionBox();
    }
    
    isNearEdge(x, note) {
        const noteX = note.beat * this.pixelsPerBeat;
        const noteWidth = note.duration * this.pixelsPerBeat;
        const edgeThreshold = 6;
        return Math.abs(x - noteX) <= edgeThreshold || Math.abs(x - (noteX + noteWidth)) <= edgeThreshold;
    }
    
    nearestEdge(x, note) {
        const noteX = note.beat * this.pixelsPerBeat;
        const noteWidth = note.duration * this.pixelsPerBeat;
        return Math.abs(x - noteX) < Math.abs(x - (noteX + noteWidth)) ? 'left' : 'right';
    }
    
    addNote(x, y) {
        const beatFloat = x / this.pixelsPerBeat;
        const beat = this.snapToGrid ? Math.round(beatFloat * 4) / 4 : beatFloat;
        const noteIndex = Math.floor(y / this.noteHeight);
        const midiNote = this.lowestNote + (this.totalNotes - 1 - noteIndex);
        
        const existingNote = this.notes.find(n => Math.abs(n.beat - beat) < 0.01 && n.midiNote === midiNote);
        if (!existingNote) {
            const note = {
                id: Date.now() + Math.random(),
                beat: beat,
                duration: 1,
                midiNote: midiNote,
                velocity: 100
            };
            this.notes.push(note);
            this.selectedNotes = [note];
        }
    }
    
    deleteNoteAt(x, y) {
        const note = this.getNoteAt(x, y);
        if (note) {
            this.notes = this.notes.filter(n => n.id !== note.id);
            this.selectedNotes = this.selectedNotes.filter(n => n.id !== note.id);
        }
    }
    
    getNoteAt(x, y) {
        const noteIndex = Math.floor(y / this.noteHeight);
        const midiNote = this.lowestNote + (this.totalNotes - 1 - noteIndex);
        
        return this.notes.find(note => {
            const noteX = note.beat * this.pixelsPerBeat;
            const noteWidth = note.duration * this.pixelsPerBeat;
            const noteY = (this.totalNotes - 1 - (note.midiNote - this.lowestNote)) * this.noteHeight;
            return x >= noteX && x <= noteX + noteWidth && y >= noteY && y <= noteY + this.noteHeight;
        });
    }
    
    toggleNoteSelection(note) {
        const index = this.selectedNotes.findIndex(n => n.id === note.id);
        if (index >= 0) {
            this.selectedNotes.splice(index, 1);
        } else {
            this.selectedNotes.push(note);
        }
    }
    
    moveSelectedNotes(deltaX, deltaY) {
        const deltaBeatRaw = deltaX / this.pixelsPerBeat;
        const deltaNotesRaw = -deltaY / this.noteHeight;
        const deltaBeat = this.snapToGrid ? Math.round(deltaBeatRaw * 4) / 4 : deltaBeatRaw;
        const deltaNotes = Math.round(deltaNotesRaw);
        
        this.selectedNotes.forEach(note => {
            note.beat = Math.max(0, note.beat + deltaBeat);
            note.midiNote = Math.max(this.lowestNote, Math.min(this.lowestNote + this.totalNotes - 1, note.midiNote + deltaNotes));
        });
    }
    
    createSelectionBox(x, y) {
        this.selectionBox = { startX: x, startY: y, endX: x, endY: y };
    }
    
    updateSelectionBox(x, y) {
        if (this.selectionBox) {
            this.selectionBox.endX = x;
            this.selectionBox.endY = y;
            this.draw();
        }
    }
    
    finishSelection() {
        if (this.selectionBox) {
            const minX = Math.min(this.selectionBox.startX, this.selectionBox.endX);
            const maxX = Math.max(this.selectionBox.startX, this.selectionBox.endX);
            const minY = Math.min(this.selectionBox.startY, this.selectionBox.endY);
            const maxY = Math.max(this.selectionBox.startY, this.selectionBox.endY);
            
            this.selectedNotes = this.notes.filter(note => {
                const noteX = note.beat * this.pixelsPerBeat;
                const noteWidth = note.duration * this.pixelsPerBeat;
                const noteY = (this.totalNotes - 1 - (note.midiNote - this.lowestNote)) * this.noteHeight;
                return noteX + noteWidth >= minX && noteX <= maxX && noteY + this.noteHeight >= minY && noteY <= maxY;
            });
        }
    }
    
    removeSelectionBox() {
        this.selectionBox = null;
        this.draw();
    }
    
    setTool(tool) {
        this.currentTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(tool + 'Tool').classList.add('active');
        if (tool === 'pencil' || tool === 'erase') {
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }
    
    adjustZoom(factor) {
        const prevZoom = this.zoom;
        this.zoom *= factor;
        this.zoom = Math.max(0.25, Math.min(4, this.zoom));
        
        this.pixelsPerBeat = this.basePixelsPerBeat * this.zoom;
        this.noteHeight = this.baseNoteHeight * this.zoom;
        
        // Regenerate keys to match new note height
        this.generatePianoKeys();
        
        // Resize canvases
        this.setupCanvas();
        
        document.getElementById('zoomLevel').textContent = Math.round(this.zoom * 100) + '%';
        this.draw();
        this.drawTimeRuler();
    }
    
    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();
        this.drawNotes();
        this.drawSelectionBox();
        this.drawPlayhead();
        this.updateInfoBar();
    }
    
    drawGrid() {
        this.ctx.strokeStyle = '#333333';
        this.ctx.lineWidth = 1;
        
        // Horizontal lines
        for (let i = 0; i <= this.totalNotes; i++) {
            const y = i * this.noteHeight;
            if (i > 0) {
                const midiNote = this.lowestNote + (this.totalNotes - i);
                const noteIndex = midiNote % 12;
                if (noteIndex === 0) {
                    this.ctx.strokeStyle = '#555555';
                    this.ctx.lineWidth = 1;
                } else {
                    this.ctx.strokeStyle = '#333333';
                    this.ctx.lineWidth = 1;
                }
            }
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
        
        // Vertical lines
        const totalBeats = Math.ceil(this.canvas.width / this.pixelsPerBeat);
        for (let beat = 0; beat <= totalBeats; beat++) {
            const x = beat * this.pixelsPerBeat;
            if (beat % this.beatsPerBar === 0) {
                this.ctx.strokeStyle = '#777777';
                this.ctx.lineWidth = 2;
            } else {
                this.ctx.strokeStyle = '#555555';
                this.ctx.lineWidth = 1;
            }
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
    }
    
    drawNotes() {
        this.notes.forEach(note => {
            const x = note.beat * this.pixelsPerBeat;
            const y = (this.totalNotes - 1 - (note.midiNote - this.lowestNote)) * this.noteHeight;
            const width = note.duration * this.pixelsPerBeat;
            const height = this.noteHeight - 1;
            const isSelected = this.selectedNotes.some(n => n.id === note.id);
            
            if (isSelected) {
                this.ctx.fillStyle = '#ff8c5a';
                this.ctx.strokeStyle = '#ffffff';
                this.ctx.lineWidth = 2;
            } else {
                this.ctx.fillStyle = '#ff6b35';
                this.ctx.strokeStyle = '#ff8c00';
                this.ctx.lineWidth = 1;
            }
            this.ctx.fillRect(x, y, width, height);
            this.ctx.strokeRect(x, y, width, height);
            
            // Edge handles
            this.ctx.fillStyle = '#ffffff';
            this.ctx.globalAlpha = 0.8;
            this.ctx.fillRect(x - 2, y + 2, 4, height - 4);
            this.ctx.fillRect(x + width - 2, y + 2, 4, height - 4);
            this.ctx.globalAlpha = 1;
            
            if (width > 40) {
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = '10px Segoe UI';
                this.ctx.textAlign = 'left';
                this.ctx.fillText(this.getNoteNameFromMidi(note.midiNote), x + 4, y + Math.min(14, height - 4));
            }
        });
    }
    
    drawSelectionBox() {
        if (this.selectionBox) {
            const x = Math.min(this.selectionBox.startX, this.selectionBox.endX);
            const y = Math.min(this.selectionBox.startY, this.selectionBox.endY);
            const width = Math.abs(this.selectionBox.endX - this.selectionBox.startX);
            const height = Math.abs(this.selectionBox.endY - this.selectionBox.startY);
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.fillRect(x, y, width, height);
            this.ctx.setLineDash([]);
        }
    }
    
    drawPlayhead() {
        if (this.isPlaying) {
            const x = this.currentTime * this.pixelsPerBeat;
            this.ctx.strokeStyle = '#00ff00';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
    }
    
    drawTimeRuler() {
        this.timeRulerCtx.clearRect(0, 0, this.timeRulerCanvas.width, this.timeRulerCanvas.height);
        this.timeRulerCtx.fillStyle = '#cccccc';
        this.timeRulerCtx.font = '11px Segoe UI';
        this.timeRulerCtx.textAlign = 'left';
        const totalBeats = Math.ceil(this.timeRulerCanvas.width / this.pixelsPerBeat);
        for (let beat = 0; beat <= totalBeats; beat++) {
            const x = beat * this.pixelsPerBeat;
            if (beat % this.beatsPerBar === 0) {
                const bar = Math.floor(beat / this.beatsPerBar) + 1;
                this.timeRulerCtx.fillText(bar.toString(), x + 2, 20);
                this.timeRulerCtx.strokeStyle = '#777777';
                this.timeRulerCtx.lineWidth = 1;
                this.timeRulerCtx.beginPath();
                this.timeRulerCtx.moveTo(x, 25);
                this.timeRulerCtx.lineTo(x, 30);
                this.timeRulerCtx.stroke();
            } else {
                this.timeRulerCtx.strokeStyle = '#555555';
                this.timeRulerCtx.lineWidth = 1;
                this.timeRulerCtx.beginPath();
                this.timeRulerCtx.moveTo(x, 27);
                this.timeRulerCtx.lineTo(x, 30);
                this.timeRulerCtx.stroke();
            }
        }
    }
    
    getNoteNameFromMidi(midiNote) {
        const noteIndex = midiNote % 12;
        const octave = Math.floor(midiNote / 12) - 1;
        return this.noteNames[noteIndex] + octave;
    }
    
    updateInfoBar() {
        document.getElementById('selectedNotes').textContent = `${this.selectedNotes.length} notes selected`;
    }
    
    togglePlayback() {
        this.isPlaying = !this.isPlaying;
        const playBtn = document.getElementById('playBtn');
        if (this.isPlaying) {
            playBtn.textContent = '⏸️';
            this.startPlayback();
        } else {
            playBtn.textContent = '▶️';
            this.stopPlayback();
        }
    }
    
    ensureAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.audioCtx;
    }
    
    startPlayback() {
        const ctx = this.ensureAudio();
        const bpm = 120;
        const secondsPerBeat = 60 / bpm;
        this.playbackStartTime = ctx.currentTime - (this.currentTime * secondsPerBeat);
        
        // Schedule simple beeps per note (very basic synth)
        const scheduleWindow = 0.25; // seconds ahead
        const schedule = () => {
            if (!this.isPlaying) return;
            const now = ctx.currentTime;
            const playheadBeats = (now - this.playbackStartTime) / secondsPerBeat * 1; // 1 beat per beat
            this.currentTime = playheadBeats; // in beats
            this.draw();
            
            const horizon = now + scheduleWindow;
            
            this.notes.forEach(note => {
                const startTime = this.playbackStartTime + note.beat * secondsPerBeat;
                const endTime = startTime + note.duration * secondsPerBeat;
                const token = `${note.id}@${note.beat}`;
                if (startTime >= now && startTime < horizon && !this.scheduledStartTokens.has(token)) {
                    this.scheduledStartTokens.add(token);
                    this.triggerTone(note.midiNote, startTime, Math.min(0.5, endTime - startTime));
                }
            });
            
            // Time label
            const minutes = Math.floor((playheadBeats * secondsPerBeat) / 60);
            const seconds = Math.floor((playheadBeats * secondsPerBeat) % 60);
            document.getElementById('currentTime').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            this.playbackRaf = requestAnimationFrame(schedule);
        };
        this.playbackRaf = requestAnimationFrame(schedule);
    }
    
    stopPlayback() {
        if (this.playbackRaf) {
            cancelAnimationFrame(this.playbackRaf);
            this.playbackRaf = null;
        }
        this.scheduledStartTokens.clear();
    }
    
    stop() {
        this.isPlaying = false;
        this.currentTime = 0;
        this.stopPlayback();
        document.getElementById('playBtn').textContent = '▶️';
        document.getElementById('currentTime').textContent = '0:00';
        this.draw();
    }
    
    playNote(midiNote, durationSec = 0.2) {
        const ctx = this.ensureAudio();
        const now = ctx.currentTime;
        this.triggerTone(midiNote, now, durationSec);
    }
    
    triggerTone(midiNote, when, durationSec) {
        const ctx = this.ensureAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 440 * Math.pow(2, (midiNote - 69) / 12);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.2, when + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, when + durationSec);
        osc.connect(gain).connect(ctx.destination);
        osc.start(when);
        osc.stop(when + durationSec + 0.05);
    }
    
    onKeyDown(e) {
        switch(e.key) {
            case 'Delete':
            case 'Backspace':
                this.selectedNotes.forEach(note => {
                    this.notes = this.notes.filter(n => n.id !== note.id);
                });
                this.selectedNotes = [];
                this.draw();
                break;
            case 'a':
            case 'A':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    this.selectedNotes = [...this.notes];
                    this.draw();
                }
                break;
            case ' ':
                e.preventDefault();
                this.togglePlayback();
                break;
        }
    }
    
    onResize() {
        this.setupCanvas();
        this.draw();
        this.drawTimeRuler();
    }
}

// Initialize the piano roll when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.pianoRoll = new PianoRoll();
});