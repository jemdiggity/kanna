use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::Instant;

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    pub cwd: String,
    pub last_active_at: Instant,
}

impl PtySession {
    pub fn spawn(
        executable: &str,
        args: &[String],
        cwd: &str,
        env: &HashMap<String, String>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(executable);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);
        for (k, v) in env {
            cmd.env(k, v);
        }

        let child = pair.slave.spawn_command(cmd)?;
        let writer = pair.master.take_writer()?;

        Ok(PtySession {
            master: pair.master,
            writer,
            child,
            cwd: cwd.to_string(),
            last_active_at: Instant::now(),
        })
    }

    pub fn write_input(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        self.last_active_at = Instant::now();
        Ok(())
    }

    pub fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>, Box<dyn std::error::Error + Send + Sync>> {
        Ok(self.master.try_clone_reader()?)
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }

    pub fn pid(&self) -> u32 {
        self.child.process_id().unwrap_or(0)
    }

    pub fn try_wait(&mut self) -> Option<i32> {
        match self.child.try_wait() {
            Ok(Some(status)) => {
                // ExitStatus has a success() method; extract the code
                if status.success() {
                    Some(0)
                } else {
                    // portable_pty doesn't expose the raw exit code directly via a method,
                    // but ExitStatus implements Display showing the code
                    Some(1)
                }
            }
            Ok(None) => None,
            Err(_) => None,
        }
    }

    pub fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill()
    }

    pub fn signal(&self, sig: i32) -> std::io::Result<()> {
        let pid = self.child.process_id().unwrap_or(0) as libc::pid_t;
        if pid == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "no pid"));
        }
        let ret = unsafe { libc::kill(pid, sig) };
        if ret == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}
