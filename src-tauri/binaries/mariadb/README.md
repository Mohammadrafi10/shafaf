# Portable MariaDB for embedded MySQL

Place the **extracted** MariaDB Windows ZIP here so that this folder contains a `bin` subfolder with:

- `mariadbd.exe` (or `mariadbd` on macOS/Linux)
- `mariadb-install-db.exe` (or `mariadb-install-db` on macOS/Linux)

## Steps

1. Download the MariaDB Windows ZIP package from:  
   https://mariadb.org/download/
2. Extract the ZIP.
3. Copy the **contents** of the extracted folder (the folder that contains `bin`, `lib`, etc.) into this `mariadb` folder.

Final structure:

```
binaries/mariadb/
  bin/
    mariadbd.exe
    mariadb-install-db.exe
    ... (other DLLs and exes)
  lib/
  share/
  ...
```

The app will use the `bin` directory to run the server and store data in the user's App Data directory (not here).
