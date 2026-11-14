CREATE TABLE users (
 id text PRIMARY KEY, name text NOT NULL
);
CREATE TABLE spaces (
 id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT ''
);
CREATE TABLE space_members (
 space_id text REFERENCES spaces(id) ON DELETE CASCADE,
 user_id text REFERENCES users(id), PRIMARY KEY(space_id,user_id)
);
CREATE TABLE boards (
 id text PRIMARY KEY, space_id text NOT NULL REFERENCES spaces(id),
 name text NOT NULL, key text NOT NULL UNIQUE CHECK(key ~ '^[A-Z]{2,10}$'),
 next_number integer NOT NULL DEFAULT 1, UNIQUE(id,space_id)
);
CREATE TABLE board_members (
 board_id text NOT NULL, space_id text NOT NULL, user_id text NOT NULL,
 PRIMARY KEY(board_id,user_id),
 FOREIGN KEY(board_id,space_id) REFERENCES boards(id,space_id) ON DELETE CASCADE,
 FOREIGN KEY(space_id,user_id) REFERENCES space_members(space_id,user_id) ON DELETE CASCADE
);
CREATE TABLE issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), board_id text NOT NULL REFERENCES boards(id),
 number integer NOT NULL, title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=10000),
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 assignee_id text, reporter_id text NOT NULL REFERENCES users(id), due_date date,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(board_id,number),
 FOREIGN KEY(board_id,assignee_id) REFERENCES board_members(board_id,user_id)
);
CREATE INDEX issues_assignee ON issues(assignee_id,board_id);
CREATE INDEX issues_board ON issues(board_id,number);
