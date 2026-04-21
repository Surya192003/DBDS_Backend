-- PostgreSQL Schema for Dance Management System

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (central authentication)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('STUDENT', 'INSTRUCTOR', 'ADMIN')),
    phone VARCHAR(20),
    address TEXT,
    is_active BOOLEAN DEFAULT FALSE,
    profile_complete BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP,
    last_failed_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Add indexes for performance
    CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attended_classes INTEGER DEFAULT 0,
    total_classes INTEGER DEFAULT 0,
    membership_status VARCHAR(20) DEFAULT 'active' CHECK (membership_status IN ('active', 'inactive', 'suspended')),
    emergency_contact VARCHAR(100),
    medical_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);

-- Instructors table
CREATE TABLE IF NOT EXISTS instructors (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pay_per_class DECIMAL(10, 2) DEFAULT 50.00,
    total_classes_taught INTEGER DEFAULT 0,
    rating DECIMAL(3, 2) DEFAULT 0.00,
    bio TEXT,
    specialties TEXT[],
    available_days VARCHAR(50)[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_rating CHECK (rating >= 0 AND rating <= 5)
);

CREATE INDEX IF NOT EXISTS idx_instructors_user_id ON instructors(user_id);

-- Classes table
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    class_name VARCHAR(100) NOT NULL,
    description TEXT,
    instructor_id INTEGER NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
    class_date DATE NOT NULL,
    class_time TIME NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    max_students INTEGER DEFAULT 20,
    current_students INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'ongoing', 'completed', 'cancelled')),
    location VARCHAR(200),
    song_link TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_class_date CHECK (class_date >= CURRENT_DATE),
    CONSTRAINT valid_duration CHECK (duration_minutes > 0 AND duration_minutes <= 240)
);

CREATE INDEX IF NOT EXISTS idx_classes_instructor_id ON classes(instructor_id);
CREATE INDEX IF NOT EXISTS idx_classes_date ON classes(class_date);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);

-- Attendance table
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    check_in_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_present BOOLEAN DEFAULT FALSE,
    notes TEXT,
    marked_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_class_id ON attendance(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(check_in_time);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    payment_date DATE DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'online', 'bank_transfer')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    description TEXT,
    invoice_number VARCHAR(50) UNIQUE,
    transaction_id VARCHAR(100),
    paid_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT positive_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payments_student_id ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- Groups table (for group classes or batches)
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL,
    description TEXT,
    instructor_id INTEGER REFERENCES instructors(id) ON DELETE SET NULL,
    max_students INTEGER DEFAULT 15,
    current_students INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'full', 'archived')),
    schedule TEXT,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_groups_instructor_id ON groups(instructor_id);
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);

-- Group Members table (many-to-many relationship)
CREATE TABLE IF NOT EXISTS group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    joined_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'removed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_student_id ON group_members(student_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) CHECK (type IN ('info', 'warning', 'success', 'error', 'payment', 'attendance')),
    is_read BOOLEAN DEFAULT FALSE,
    related_id INTEGER, -- Could link to payment_id, class_id, etc.
    related_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Audit Log table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    table_name VARCHAR(50),
    record_id INTEGER,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Settings table (for system configuration)
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(50) DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(setting_key);

-- Insert default settings
INSERT INTO settings (setting_key, setting_value, setting_type, description) VALUES
    ('site_name', 'Dance Management System', 'string', 'Name of the dance studio'),
    ('currency', 'EUR', 'string', 'Default currency'),
    ('instructor_default_pay', '30.00', 'decimal', 'Default pay per class for instructors'),
    ('class_default_duration', '60', 'integer', 'Default class duration in minutes'),
    ('max_students_per_class', '25', 'integer', 'Maximum students allowed in a class'),
    ('attendance_reminder_hours', '24', 'integer', 'Hours before class to send reminder'),
    ('payment_due_days', '30', 'integer', 'Days before payment is due')
ON CONFLICT (setting_key) DO NOTHING;

-- Insert a default admin user (password: Admin123)
-- You should change this password immediately after setup
INSERT INTO users (name, email, password, role, is_active, profile_complete) 
VALUES (
    'System Administrator', 
    'admin@dancemanagement.com', 
    '$2b$10$WgOGDpdRXBYmPxCOrvncF.zqykNBNqIHxSh/J40zbD5xqXdH7CPD2', -- Replace with actual bcrypt hash of 'Admin123'
    'ADMIN', 
    TRUE, 
    TRUE
) ON CONFLICT (email) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_instructors_updated_at BEFORE UPDATE ON instructors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_classes_updated_at BEFORE UPDATE ON classes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate student attendance rate
CREATE OR REPLACE FUNCTION calculate_attendance_rate(student_id INTEGER)
RETURNS DECIMAL AS $$
DECLARE
    total_classes INTEGER;
    attended_classes INTEGER;
    attendance_rate DECIMAL;
BEGIN
    SELECT 
        COALESCE(SUM(CASE WHEN a.is_present THEN 1 ELSE 0 END), 0),
        COALESCE(COUNT(*), 0)
    INTO attended_classes, total_classes
    FROM attendance a
    JOIN classes c ON a.class_id = c.id
    WHERE a.student_id = calculate_attendance_rate.student_id;
    
    IF total_classes > 0 THEN
        attendance_rate := (attended_classes::DECIMAL / total_classes::DECIMAL) * 100;
    ELSE
        attendance_rate := 0;
    END IF;
    
    RETURN ROUND(attendance_rate, 2);
END;
$$ LANGUAGE plpgsql;

-- View for student dashboard
CREATE OR REPLACE VIEW student_dashboard AS
SELECT 
    s.id as student_id,
    u.name as student_name,
    u.email,
    s.attended_classes,
    s.total_classes,
    calculate_attendance_rate(s.id) as attendance_rate,
    s.membership_status,
    COUNT(DISTINCT gm.group_id) as active_groups,
    COALESCE(SUM(CASE WHEN p.status = 'completed' THEN p.amount ELSE 0 END), 0) as total_paid
FROM students s
JOIN users u ON s.user_id = u.id
LEFT JOIN group_members gm ON s.id = gm.student_id AND gm.status = 'active'
LEFT JOIN payments p ON s.id = p.student_id
WHERE u.is_active = TRUE
GROUP BY s.id, u.name, u.email, s.attended_classes, s.total_classes, s.membership_status;

-- View for instructor dashboard
CREATE OR REPLACE VIEW instructor_dashboard AS
SELECT 
    i.id as instructor_id,
    u.name as instructor_name,
    u.email,
    i.pay_per_class,
    i.total_classes_taught,
    i.rating,
    COUNT(DISTINCT c.id) as upcoming_classes,
    COUNT(DISTINCT g.id) as active_groups,
    COALESCE(SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END), 0) as completed_classes_last_month
FROM instructors i
JOIN users u ON i.user_id = u.id
LEFT JOIN classes c ON i.id = c.instructor_id AND c.class_date >= CURRENT_DATE
LEFT JOIN groups g ON i.id = g.instructor_id AND g.status = 'active'
WHERE u.is_active = TRUE
GROUP BY i.id, u.name, u.email, i.pay_per_class, i.total_classes_taught, i.rating;

-- Add comments to tables
COMMENT ON TABLE users IS 'Stores all user accounts for the dance management system';
COMMENT ON TABLE students IS 'Student-specific information linked to users table';
COMMENT ON TABLE instructors IS 'Instructor-specific information linked to users table';
COMMENT ON TABLE classes IS 'Dance classes scheduled by instructors';
COMMENT ON TABLE attendance IS 'Attendance records for students in classes';
COMMENT ON TABLE payments IS 'Payment records for students';
COMMENT ON TABLE groups IS 'Groups or batches for dance classes';
COMMENT ON TABLE group_members IS 'Many-to-many relationship between groups and students';
COMMENT ON TABLE notifications IS 'System notifications for users';
COMMENT ON TABLE audit_logs IS 'Audit trail for system activities';
COMMENT ON TABLE settings IS 'System configuration settings';

-- Create a read-only user for reporting (optional)
-- CREATE USER report_user WITH PASSWORD 'secure_password';
-- GRANT CONNECT ON DATABASE dance_management TO report_user;
-- GRANT USAGE ON SCHEMA public TO report_user;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO report_user;

ALTER TABLE users ADD COLUMN photo_url VARCHAR(500);