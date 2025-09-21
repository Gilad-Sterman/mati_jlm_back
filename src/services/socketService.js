const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin } = require('../config/database');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socket.id
    this.userSockets = new Map(); // socket.id -> user info
  }

  /**
   * Initialize Socket.io with the server
   */
  initialize(server) {
    const { Server } = require('socket.io');
    
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupMiddleware();
    this.setupEventHandlers();
    
    console.log('🔌 Socket.io initialized');
    return this.io;
  }

  /**
   * Setup authentication middleware for Socket.io
   */
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user details from database
        const client = supabaseAdmin || supabase;
        const { data: user, error } = await client
          .from('users')
          .select('id, email, name, role, is_active')
          .eq('id', decoded.userId)
          .single();

        if (error || !user || !user.is_active) {
          return next(new Error('Invalid or inactive user'));
        }

        // Attach user info to socket
        socket.userId = user.id;
        socket.userEmail = user.email;
        socket.userName = user.name;
        socket.userRole = user.role;
        
        next();
      } catch (error) {
        console.error('Socket authentication error:', error.message);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup main event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      // Basic event handlers
      socket.on('disconnect', () => this.handleDisconnection(socket));
      socket.on('ping', (callback) => this.handlePing(socket, callback));
      socket.on('join_room', (data) => this.handleJoinRoom(socket, data));
      socket.on('leave_room', (data) => this.handleLeaveRoom(socket, data));
      
      // Future AI processing events (placeholders)
      socket.on('subscribe_session_updates', (data) => this.handleSubscribeSessionUpdates(socket, data));
      socket.on('unsubscribe_session_updates', (data) => this.handleUnsubscribeSessionUpdates(socket, data));
    });
  }

  /**
   * Handle new socket connection
   */
  handleConnection(socket) {
    console.log(`🔗 User connected: ${socket.userName} (${socket.userEmail}) - Socket: ${socket.id}`);
    
    // Store user connection
    this.connectedUsers.set(socket.userId, socket.id);
    this.userSockets.set(socket.id, {
      userId: socket.userId,
      email: socket.userEmail,
      name: socket.userName,
      role: socket.userRole,
      connectedAt: new Date()
    });

    // Join user to their personal room (for targeted messages)
    socket.join(`user_${socket.userId}`);
    
    // Join role-based room
    socket.join(`role_${socket.userRole}`);

    // Send welcome message
    socket.emit('connected', {
      message: 'Connected successfully',
      userId: socket.userId,
      role: socket.userRole,
      connectedAt: new Date()
    });

    // Broadcast to admins about new connection (optional)
    if (socket.userRole !== 'admin') {
      this.io.to('role_admin').emit('user_connected', {
        userId: socket.userId,
        name: socket.userName,
        email: socket.userEmail,
        role: socket.userRole,
        connectedAt: new Date()
      });
    }
  }

  /**
   * Handle socket disconnection
   */
  handleDisconnection(socket) {
    console.log(`🔌 User disconnected: ${socket.userName} - Socket: ${socket.id}`);
    
    // Remove from tracking
    this.connectedUsers.delete(socket.userId);
    this.userSockets.delete(socket.id);

    // Broadcast to admins about disconnection (optional)
    if (socket.userRole !== 'admin') {
      this.io.to('role_admin').emit('user_disconnected', {
        userId: socket.userId,
        name: socket.userName,
        email: socket.userEmail,
        role: socket.userRole,
        disconnectedAt: new Date()
      });
    }
  }

  /**
   * Handle ping/pong for connection testing
   */
  handlePing(socket, callback) {
    console.log(`🏓 Ping from ${socket.userName}`);
    if (callback) {
      callback({
        message: 'pong',
        timestamp: new Date(),
        userId: socket.userId
      });
    }
  }

  /**
   * Handle joining custom rooms
   */
  handleJoinRoom(socket, data) {
    const { room } = data;
    if (!room || typeof room !== 'string') {
      socket.emit('error', { message: 'Invalid room name' });
      return;
    }

    // Basic room validation (can be expanded)
    const allowedRoomPrefixes = ['session_', 'client_', 'project_'];
    const isValidRoom = allowedRoomPrefixes.some(prefix => room.startsWith(prefix));
    
    if (!isValidRoom) {
      socket.emit('error', { message: 'Room not allowed' });
      return;
    }

    socket.join(room);
    socket.emit('room_joined', { room, joinedAt: new Date() });
    console.log(`📍 ${socket.userName} joined room: ${room}`);
  }

  /**
   * Handle leaving custom rooms
   */
  handleLeaveRoom(socket, data) {
    const { room } = data;
    if (!room || typeof room !== 'string') {
      socket.emit('error', { message: 'Invalid room name' });
      return;
    }

    socket.leave(room);
    socket.emit('room_left', { room, leftAt: new Date() });
    console.log(`📍 ${socket.userName} left room: ${room}`);
  }

  /**
   * Handle session updates subscription (placeholder for AI processing)
   */
  handleSubscribeSessionUpdates(socket, data) {
    const { sessionId } = data;
    if (!sessionId) {
      socket.emit('error', { message: 'Session ID required' });
      return;
    }

    // Join session-specific room for updates
    socket.join(`session_${sessionId}`);
    socket.emit('subscribed_session_updates', { 
      sessionId, 
      subscribedAt: new Date() 
    });
    
    console.log(`📊 ${socket.userName} subscribed to session updates: ${sessionId}`);
  }

  /**
   * Handle session updates unsubscription
   */
  handleUnsubscribeSessionUpdates(socket, data) {
    const { sessionId } = data;
    if (!sessionId) {
      socket.emit('error', { message: 'Session ID required' });
      return;
    }

    socket.leave(`session_${sessionId}`);
    socket.emit('unsubscribed_session_updates', { 
      sessionId, 
      unsubscribedAt: new Date() 
    });
    
    console.log(`📊 ${socket.userName} unsubscribed from session updates: ${sessionId}`);
  }

  /**
   * Send message to specific user
   */
  sendToUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.io.to(`user_${userId}`).emit(event, data);
      return true;
    }
    return false;
  }

  /**
   * Send message to all users with specific role
   */
  sendToRole(role, event, data) {
    this.io.to(`role_${role}`).emit(event, data);
  }

  /**
   * Send message to specific session subscribers
   */
  sendToSession(sessionId, event, data) {
    this.io.to(`session_${sessionId}`).emit(event, data);
  }

  /**
   * Broadcast to all connected users
   */
  broadcast(event, data) {
    this.io.emit(event, data);
  }

  /**
   * Get connected users info
   */
  getConnectedUsers() {
    const users = [];
    this.userSockets.forEach((userInfo, socketId) => {
      users.push({
        socketId,
        ...userInfo
      });
    });
    return users;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const users = this.getConnectedUsers();
    const stats = {
      totalConnected: users.length,
      byRole: {},
      connections: users
    };

    users.forEach(user => {
      stats.byRole[user.role] = (stats.byRole[user.role] || 0) + 1;
    });

    return stats;
  }
}

// Export singleton instance
module.exports = new SocketService();
