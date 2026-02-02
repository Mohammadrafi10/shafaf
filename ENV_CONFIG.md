# Environment Configuration

This application uses environment variables for configuration. Create a `.env` file in the root directory based on `.env.example`.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration values.

## Configuration Variables

### Database Configuration (MySQL)

- `MYSQL_HOST`: MySQL server host (default: `127.0.0.1`)
- `MYSQL_PORT`: MySQL server port (default: `3306`)
- `MYSQL_USER`: MySQL username
- `MYSQL_PASSWORD`: MySQL password
- `MYSQL_DATABASE`: Database name to use

Example:
```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=myuser
MYSQL_PASSWORD=mypassword
MYSQL_DATABASE=tauri_app
```

### Application Configuration

- `APP_NAME`: Application name (default: "Tauri App")
- `APP_VERSION`: Application version (default: "0.1.0")
- `LOG_LEVEL`: Logging level - DEBUG, INFO, WARN, ERROR (default: "INFO")
- `DEV_MODE`: Development mode flag - true/false (default: "true")

## Usage

The environment variables are loaded automatically when the application starts. The Rust backend reads from the `.env` file using the `dotenv` crate.

## Notes

- The `.env` file is excluded from version control (see `.gitignore`)
- Always use `.env.example` as a template for creating your `.env` file
- Never commit your `.env` file to version control as it may contain sensitive information
- A MySQL server must be running and the database created (or use `db_create` from the app) before opening the database
