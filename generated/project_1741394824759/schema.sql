CREATE TABLE IF NOT EXISTS authors (
    id integer primary key auto_increment,
    name varchar not null,
    biography text 
);

CREATE TABLE IF NOT EXISTS books (
    id integer primary key auto_increment,
    title varchar not null,
    isbn varchar not null unique,
    publication_year integer not null,
    copies_available integer not null,
    author_id integer foreign key
);

CREATE TABLE IF NOT EXISTS members (
    id integer primary key auto_increment,
    name varchar not null,
    email varchar not null unique,
    membership_status varchar not null
);

CREATE TABLE IF NOT EXISTS loans (
    id integer primary key auto_increment,
    book_id integer foreign key,
    member_id integer foreign key,
    checkout_date date not null,
    due_date date not null
);