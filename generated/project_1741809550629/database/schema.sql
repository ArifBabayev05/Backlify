-- Database schema for the API

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    id integer primary key,
    username varchar not null unique,
    email varchar not null unique,
    password varchar not null
);

-- Create posts table
CREATE TABLE IF NOT EXISTS posts (
    id integer primary key,
    title varchar not null,
    content text not null,
    user_id integer not null foreign key,
    created_at timestamp not null,
    updated_at timestamp not null
);

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
    id integer primary key,
    content text not null,
    post_id integer not null foreign key,
    user_id integer not null foreign key,
    created_at timestamp not null,
    updated_at timestamp not null
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
