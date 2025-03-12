-- Database schema for the API

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id integer primary key auto_increment,
    username varchar(50) not null unique,
    email varchar(100) not null unique,
    password_hash varchar(255) not null
);

-- Create posts table
CREATE TABLE IF NOT EXISTS posts (
    id integer primary key auto_increment,
    user_id integer not null,
    title varchar(255) not null,
    content text not null,
    created_at timestamp not null default: current_timestamp
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
    id integer primary key auto_increment,
    post_id integer not null,
    user_id integer not null,
    content text not null,
    created_at timestamp not null default: current_timestamp
);

-- Add foreign key constraint for posts.user_id -> users.id
ALTER TABLE posts 
ADD CONSTRAINT fk_posts_users 
FOREIGN KEY (user_id) 
REFERENCES users(id);

-- Add foreign key constraint for comments.post_id -> posts.id
ALTER TABLE comments 
ADD CONSTRAINT fk_comments_posts 
FOREIGN KEY (post_id) 
REFERENCES posts(id);

-- Add foreign key constraint for comments.user_id -> users.id
ALTER TABLE comments 
ADD CONSTRAINT fk_comments_users 
FOREIGN KEY (user_id) 
REFERENCES users(id);
