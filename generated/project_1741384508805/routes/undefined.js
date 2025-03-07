
            const { supabase } = require('../db');
            
            module.exports = (app) => {
                // Get all
                app.get('/undefined', async (req, res) => {
                    const { data, error } = await supabase
                        .from('undefined')
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.json(data);
                });
                
                // Get one
                app.get('/undefined/:id', async (req, res) => {
                    const { data, error } = await supabase
                        .from('undefined')
                        .select()
                        .eq('id', req.params.id)
                        .single();
                    if (error) return res.status(500).json({ error });
                    if (!data) return res.status(404).json({ error: 'Not found' });
                    res.json(data);
                });
                
                // Create
                app.post('/undefined', async (req, res) => {
                    const { data, error } = await supabase
                        .from('undefined')
                        .insert(req.body)
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.status(201).json(data);
                });
                
                // Update
                app.put('/undefined/:id', async (req, res) => {
                    const { data, error } = await supabase
                        .from('undefined')
                        .update(req.body)
                        .eq('id', req.params.id)
                        .select();
                    if (error) return res.status(500).json({ error });
                    res.json(data);
                });
                
                // Delete
                app.delete('/undefined/:id', async (req, res) => {
                    const { error } = await supabase
                        .from('undefined')
                        .delete()
                        .eq('id', req.params.id);
                    if (error) return res.status(500).json({ error });
                    res.status(204).send();
                });
            };
        